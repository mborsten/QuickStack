import { stringToNumber, stringToOptionalNumber } from "@/shared/utils/zod.utils";
import { z } from "zod";

export const appRateLimitsZodModel = z.object({
  command: z.string().nullable().optional(),
  memoryReservation: stringToOptionalNumber,
  memoryLimit: stringToOptionalNumber,
  cpuReservation: stringToOptionalNumber,
  cpuLimit: stringToOptionalNumber,
  replicas: stringToNumber,
})

export type AppRateLimitsModel = z.infer<typeof appRateLimitsZodModel>;