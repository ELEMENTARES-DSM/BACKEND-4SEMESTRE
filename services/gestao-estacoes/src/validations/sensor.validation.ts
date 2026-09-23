import { z } from "zod";
import { TIPOS_SENSOR } from "../models/sensor.model";

export const createSensorSchema = z.object({
  tipo: z.enum(TIPOS_SENSOR as [string, ...string[]]),
  fator: z.number().optional(),
  ganho: z.number().optional(),
});

export const updateSensorSchema = createSensorSchema;

export const updateSensorStatusSchema = z.object({
  status: z.enum(["Ativo", "Inativo"]),
});

export const estacaoIdParamSchema = z.object({
  estacaoId: z.string().uuid(),
});

export const sensorIdParamSchema = z.object({
  id: z.string().uuid(),
});
