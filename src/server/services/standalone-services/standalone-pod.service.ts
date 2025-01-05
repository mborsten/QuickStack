import k3s from "../../adapter/kubernetes-api.adapter";
import fs from 'fs';
import stream from 'stream';
import * as k8s from '@kubernetes/client-node';

class SetupPodService {

    async waitUntilPodIsRunningFailedOrSucceded(projectId: string, podName: string) {
        const timeout = 120000;
        const interval = 1000;
        const maxTries = timeout / interval;
        let tries = 0;

        while (tries < maxTries) {
            const pod = await this.getPodOrUndefined(projectId, podName);
            if (pod && ['Running', 'Failed', 'Succeeded'].includes(pod.status?.phase!)) {
                return true;
            }

            await new Promise(resolve => setTimeout(resolve, interval));
            tries++;
        }

        return false;
    }

    async getPodOrUndefined(projectId: string, podName: string) {
        const res = await k3s.core.listNamespacedPod(projectId);
        return res.body.items.find((item) => item.metadata?.name === podName);
    }

    async getPodsForApp(projectId: string, appId: string): Promise<{
        podName: string;
        containerName: string;
        uid?: string;
    }[]> {
        const res = await k3s.core.listNamespacedPod(projectId, undefined, undefined, undefined, undefined, `app=${appId}`);
        return res.body.items.map((item) => ({
            podName: item.metadata?.name!,
            containerName: item.spec?.containers?.[0].name!,
            uid: item.metadata?.uid,
        })).filter((item) => !!item.podName && !!item.containerName);
    }

    public async runCommandInPod(
        namespace: string,
        podName: string,
        containerName: string,
        command: string[],
    ): Promise<void> {
        const writerStream = new stream.PassThrough();
        const stderrStream = new stream.PassThrough();
        return new Promise<void>((resolve, reject) => {

            const exec = new k8s.Exec(k3s.getKubeConfig());
            exec
                .exec(
                    namespace,
                    podName,
                    containerName,
                    command,
                    writerStream,
                    stderrStream,
                    null,
                    false,
                    async ({ status }) => {
                        try {
                            console.log(`Output for command "${command.join(' ')}": \n ${writerStream.read().toString()}`);
                            if (status === 'Failure') {
                                return reject(
                                    new Error(
                                        `Error while running command "${command.join(' ')}": \n ${stderrStream.read().toString()}`,
                                    ),
                                );
                            }
                            resolve();
                        } catch (e) {
                            reject(e);
                        }
                    },
                )
                .catch(reject);
        });
    }

    /**
     * Copied out of Kubernetes SDK because for whatever reason
     * cp.fromPod is not working using the sdk bcause of an error with some buffer
     * Source: https://github.com/kubernetes-client/javascript/blob/master/src/cp.ts
     *
     *
     * @param {string} namespace - The namespace of the pod to exec the command inside.
     * @param {string} podName - The name of the pod to exec the command inside.
     * @param {string} containerName - The name of the container in the pod to exec the command inside.
     * @param {string} srcPath - The source path in the pod
     * @param {string} zipOutputPath - The target path in local
     * @param {string} [cwd] - The directory that is used as the parent in the pod when downloading
     */
    public async cpFromPod(
        namespace: string,
        podName: string,
        containerName: string,
        srcPath: string,
        zipOutputPath: string,
        cwd?: string,
    ): Promise<void> {
        const command = ['tar', 'zcf', '-'];
        if (cwd) {
            command.push('-C', cwd);
        }
        command.push(srcPath);
        const writerStream = fs.createWriteStream(zipOutputPath);
        const stderrStream = new stream.PassThrough();
        return new Promise<void>((resolve, reject) => {

            const exec = new k8s.Exec(k3s.getKubeConfig());
            exec
                .exec(
                    namespace,
                    podName,
                    containerName,
                    command,
                    writerStream,
                    stderrStream,
                    null,
                    false,
                    async ({ status }) => {
                        try {
                            writerStream.close();
                            if (status === 'Failure') {
                                return reject(
                                    new Error(
                                        `Error from cpFromPod - details: \n ${stderrStream.read().toString()}`,
                                    ),
                                );
                            }
                            resolve();
                        } catch (e) {
                            reject(e);
                        }
                    },
                )
                .catch(reject);
        });
    }
}

const standalonePodService = new SetupPodService();
export default standalonePodService;
