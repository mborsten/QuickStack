import k3s from "../adapter/kubernetes-api.adapter";
import { V1Deployment, V1Ingress, V1Service } from "@kubernetes/client-node";
import namespaceService from "./namespace.service";
import { StringUtils } from "../utils/string.utils";
import crypto from "crypto";

class QuickStackService {

    private readonly QUICKSTACK_NAMESPACE = 'quickstack';
    private readonly QUICKSTACK_DEPLOYMENT_NAME = 'quickstack';
    private readonly QUICKSTACK_PORT_NUMBER = 3000;
    private readonly QUICKSTACK_SERVICEACCOUNT_NAME = 'qs-service-account';
    private readonly CLUSTER_ISSUER_NAME = 'letsencrypt-production';


    async initializeQuickStack() {
        await namespaceService.createNamespaceIfNotExists(this.QUICKSTACK_NAMESPACE)
        const nextAuthSecret = await this.deleteExistingDeployment();
        await this.createOrUpdatePvc();
        await this.createOrUpdateDeployment(undefined, nextAuthSecret);
        await this.createOrUpdateService(true);
        console.log('QuickStack successfully initialized');
    }

    async createOrUpdateIngress(hostname: string) {
        const ingressName = StringUtils.getIngressName(this.QUICKSTACK_NAMESPACE);
        const existingIngresses = await k3s.network.listNamespacedIngress(this.QUICKSTACK_NAMESPACE);
        const existingIngress = existingIngresses.body.items.find((item) => item.metadata?.name === ingressName);

        const ingressDefinition: V1Ingress = {
            apiVersion: 'networking.k8s.io/v1',
            kind: 'Ingress',
            metadata: {
                name: ingressName,
                namespace: this.QUICKSTACK_NAMESPACE,
                annotations: {
                    'cert-manager.io/cluster-issuer': this.CLUSTER_ISSUER_NAME,
                    'traefik.ingress.kubernetes.io/router.middlewares': 'kube-system-redirect-to-https@kubernetescrd'  // activate redirect middleware for https
                },
            },
            spec: {
                ingressClassName: 'traefik',
                rules: [
                    {
                        host: hostname,
                        http: {
                            paths: [
                                {
                                    path: '/',
                                    pathType: 'Prefix',
                                    backend: {
                                        service: {
                                            name: StringUtils.toServiceName(this.QUICKSTACK_DEPLOYMENT_NAME),
                                            port: {
                                                number: this.QUICKSTACK_PORT_NUMBER,
                                            },
                                        },
                                    },
                                },
                            ],
                        },
                    },
                ],
                tls: [
                    {
                        hosts: [hostname],
                        secretName: `secret-tls-${hostname}`,
                    },
                ],
            },
        };

        if (existingIngress) {
            await k3s.network.replaceNamespacedIngress(ingressName, this.QUICKSTACK_NAMESPACE, ingressDefinition);
            console.log(`Ingress QuickStack for domain ${hostname} successfully updated.`);
        } else {
            await k3s.network.createNamespacedIngress(this.QUICKSTACK_NAMESPACE, ingressDefinition);
            console.log(`Ingress QuickStack for domain ${hostname} successfully created.`);
        }
    }

    async createOrUpdateCertIssuer(letsencryptMail: string) {
        const now = new Date();
        const clusterIssuerBody = {
            apiVersion: 'cert-manager.io/v1',
            kind: 'ClusterIssuer',
            metadata: {
                name: this.CLUSTER_ISSUER_NAME,
                namespace: 'default',
                //resourceVersion: now.getTime().toString(),
            },
            spec: {
                acme: {
                    email: letsencryptMail,
                    server: 'https://acme-v02.api.letsencrypt.org/directory',
                    privateKeySecretRef: {
                        name: this.CLUSTER_ISSUER_NAME,
                    },
                    solvers: [
                        {
                            selector: {},
                            http01: {
                                ingress: {
                                    class: "traefik"
                                }
                            }
                        }
                    ]
                }
            }
        };


        if (await this.checkIfClusterIssuerExists()) {
            // update
            await k3s.customObjects.patchClusterCustomObject(
                'cert-manager.io',          // group
                'v1',                       // version
                'clusterissuers',           // plural name of the custom resource
                this.CLUSTER_ISSUER_NAME,   // name of the custom resource
                clusterIssuerBody,           // object manifest
                undefined, undefined, undefined, {
                    headers: { 'Content-Type': 'application/merge-patch+json' },
                }
            );
        } else {
            // create
            await k3s.customObjects.createClusterCustomObject(
                'cert-manager.io',      // group
                'v1',                   // version
                'clusterissuers',       // plural name of the custom resource
                clusterIssuerBody       // object manifest
            );
        }
    }


    async checkIfClusterIssuerExists() {
        const res = await k3s.customObjects.listClusterCustomObject(
            'cert-manager.io',      // group
            'v1',              // namespace
            'clusterissuers',       // plural name of the custom resource
        );
        if ((res.body as any) && (res.body as any)?.items && (res.body as any)?.items?.length > 0) {
            const existingLetsecryptProduction = (res.body as any).items.find((item: any) => item.metadata.name === this.CLUSTER_ISSUER_NAME);
            if (existingLetsecryptProduction) {
                return true;
            }
        }
        return false;
    }

    async createOrUpdateService(openNodePort = false) {
        const serviceName = StringUtils.toServiceName(this.QUICKSTACK_DEPLOYMENT_NAME);
        const body: V1Service = {
            apiVersion: 'v1',
            kind: 'Service',
            metadata: {
                name: serviceName,
                namespace: this.QUICKSTACK_NAMESPACE,
            },
            spec: {
                selector: {
                    app: this.QUICKSTACK_DEPLOYMENT_NAME
                },
                ports: [
                    {
                        protocol: 'TCP',
                        port: this.QUICKSTACK_PORT_NUMBER,
                        targetPort: this.QUICKSTACK_PORT_NUMBER,
                        nodePort: openNodePort ? 30000 : undefined,
                    }
                ],
                type: openNodePort ? 'NodePort' : undefined
            }
        };

        const allServices = await k3s.core.listNamespacedService(this.QUICKSTACK_NAMESPACE);
        const existingService = allServices.body.items.find(s => s.metadata!.name === serviceName);
        if (existingService) {
            console.warn('Service already exists, deleting and recreating it');
            await k3s.core.deleteNamespacedService(serviceName, this.QUICKSTACK_NAMESPACE);
            console.log('Existing service deleted');
        } else {
            console.warn('Service does not exist, creating');
        }
        await k3s.core.createNamespacedService(this.QUICKSTACK_NAMESPACE, body);
        console.log('Service created');
    }

    private async createOrUpdatePvc() {
        const pvcName = StringUtils.toPvcName(this.QUICKSTACK_DEPLOYMENT_NAME);
        const pvc = {
            apiVersion: 'v1',
            kind: 'PersistentVolumeClaim',
            metadata: {
                name: pvcName,
                namespace: this.QUICKSTACK_NAMESPACE
            },
            spec: {
                accessModes: ['ReadWriteOnce'],
                storageClassName: 'longhorn',
                resources: {
                    requests: {
                        storage: '1Gi'
                    }
                }
            }
        };
        const allPvcs = await k3s.core.listNamespacedPersistentVolumeClaim(this.QUICKSTACK_NAMESPACE);
        const existingPvc = allPvcs.body.items.find(p => p.metadata!.name === pvcName);
        if (existingPvc) {
            if (existingPvc.spec!.resources!.requests!.storage === pvc.spec!.resources!.requests!.storage) {
                console.log(`PVC already exists with the same size, no changes`);
                return;
            }
            console.warn('PVC already exists, updating size');
            // Only the Size of PVC can be updated, so we need to delete and recreate the PVC
            // update PVC size
            existingPvc.spec!.resources!.requests!.storage = pvc.spec!.resources!.requests!.storage;
            await k3s.core.replaceNamespacedPersistentVolumeClaim(pvcName, this.QUICKSTACK_NAMESPACE, existingPvc);
            console.log('PVC updated');
        } else {
            console.warn('PVC does not exist, creating');
            await k3s.core.createNamespacedPersistentVolumeClaim(this.QUICKSTACK_NAMESPACE, pvc);
            console.log('PVC created');
        }
    }

    async createOrUpdateDeployment(nextAuthHostname?: string, inputNextAuthSecret?: string) {
        const generatedNextAuthSecret = crypto.randomBytes(32).toString('base64');
        const existingDeployment = await this.getExistingDeployment();
        const body: V1Deployment = {
            metadata: {
                name: this.QUICKSTACK_DEPLOYMENT_NAME,
            },
            spec: {
                replicas: 1,
                strategy: {
                    type: 'Recreate',
                },
                selector: {
                    matchLabels: {
                        app: this.QUICKSTACK_DEPLOYMENT_NAME
                    }
                },
                template: {
                    metadata: {
                        labels: {
                            app: this.QUICKSTACK_DEPLOYMENT_NAME
                        }
                    },
                    spec: {
                        serviceAccountName: this.QUICKSTACK_SERVICEACCOUNT_NAME,
                        securityContext: {
                            runAsUser: 1001,
                            runAsGroup: 1001,
                            fsGroup: 1001
                        },
                        containers: [
                            {
                                name: this.QUICKSTACK_DEPLOYMENT_NAME,
                                image: 'quickstack/quickstack:latest',
                                imagePullPolicy: 'Always',
                                env: [
                                    {
                                        name: 'NEXTAUTH_SECRET',
                                        value: inputNextAuthSecret || existingDeployment.nextAuthSecret || generatedNextAuthSecret
                                    },
                                    ...nextAuthHostname ? [{
                                        name: 'NEXTAUTH_URL',
                                        value: `https://${nextAuthHostname}`
                                    }] : []
                                ],
                                volumeMounts: [{
                                    name: 'quickstack-volume',
                                    mountPath: '/app/storage'
                                }]
                            }
                        ],
                        volumes: [{
                            name: 'quickstack-volume',
                            persistentVolumeClaim: {
                                claimName: StringUtils.toPvcName(this.QUICKSTACK_DEPLOYMENT_NAME)
                            }
                        }]
                    }
                }
            }
        };
        if (existingDeployment.existingDeployments) {
            await k3s.apps.replaceNamespacedDeployment(this.QUICKSTACK_DEPLOYMENT_NAME, this.QUICKSTACK_NAMESPACE, body);
            console.log('Deployment updated');
        } else {
            await k3s.apps.createNamespacedDeployment(this.QUICKSTACK_NAMESPACE, body);
            console.log('Deployment created');
        }
    }

    /**
     * @returns: the existing NEXTAUTH_SECRET if the deployment already exists
     */
    private async deleteExistingDeployment() {
        const { existingDeployments, nextAuthSecret } = await this.getExistingDeployment();
        const quickStackAlreadyDeployed = !!existingDeployments;
        if (quickStackAlreadyDeployed) {
            console.warn('QuickStack already deployed, deleting existing deployment (data wont be lost)');
            await k3s.apps.deleteNamespacedDeployment(this.QUICKSTACK_DEPLOYMENT_NAME, this.QUICKSTACK_NAMESPACE);
            console.log('Existing deployment deleted');
        }
        return nextAuthSecret;
    }

    async getExistingDeployment() {
        const allDeployments = await k3s.apps.listNamespacedDeployment(this.QUICKSTACK_NAMESPACE);
        const existingDeployments = allDeployments.body.items.find(d => d.metadata!.name === this.QUICKSTACK_DEPLOYMENT_NAME);
        const nextAuthSecret = existingDeployments?.spec?.template?.spec?.containers?.[0].env?.find(e => e.name === 'NEXTAUTH_SECRET')?.value;
        return { existingDeployments, nextAuthSecret };
    }
}

const quickStackService = new QuickStackService();
export default quickStackService;
