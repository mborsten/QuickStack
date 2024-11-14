'use server'

import { appVolumeEditZodModel } from "@/model/volume-edit.model";
import { SuccessActionResult } from "@/model/server-action-error-return.model";
import appService from "@/server/services/app.service";
import { getAuthUserSession, saveFormAction, simpleAction } from "@/server/utils/action-wrapper.utils";
import { z } from "zod";
import { ServiceException } from "@/model/service.exception.model";
import pvcStatusService from "@/server/services/pvc.status.service";

const actionAppVolumeEditZodModel = appVolumeEditZodModel.merge(z.object({
    appId: z.string(),
    id: z.string().nullish()
}));

export const saveVolume = async (prevState: any, inputData: z.infer<typeof actionAppVolumeEditZodModel>) =>
    saveFormAction(inputData, actionAppVolumeEditZodModel, async (validatedData) => {
        await getAuthUserSession();
        const existingVolume = validatedData.id ? await appService.getVolumeById(validatedData.id) : undefined;
        if (existingVolume && existingVolume.size > validatedData.size) {
            throw new ServiceException('Volume size cannot be decreased');
        }
        await appService.saveVolume({
            ...validatedData,
            id: validatedData.id ?? undefined,
            accessMode: existingVolume?.accessMode ?? validatedData.accessMode as string
        });
    });

export const deleteVolume = async (volumeID: string) =>
    simpleAction(async () => {
        await getAuthUserSession();
        await appService.deleteVolumeById(volumeID);
        return new SuccessActionResult(undefined, 'Successfully deleted volume');
    });

export const getPvcUsage = async (pvcName: string, pvcNamespace: string) =>
    simpleAction(async () => {
        await getAuthUserSession();
        return await pvcStatusService.getPvcUsageByName(pvcName, pvcNamespace);
    });
