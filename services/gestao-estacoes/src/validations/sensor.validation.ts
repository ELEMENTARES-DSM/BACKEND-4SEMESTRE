import { z } from "zod";
import { TIPOS_SENSOR } from "../models/sensor.model";

export const createSensorSchema = z.object({
  codigo: z.string().trim().min(1).max(30).optional(),
  nome: z.string().trim().min(1).max(100).optional(),
  tipo: z.enum(TIPOS_SENSOR as [string, ...string[]]),
  fator: z.number().optional(),
  ganho: z.number().optional(),
});

export const updateSensorSchema = createSensorSchema.omit({ codigo: true, nome: true });

export const updateSensorStatusSchema = z.object({
  status: z.enum(["Ativo", "Inativo"]),
});

export const estacaoIdParamSchema = z.object({
  estacaoId: z.string().uuid(),
});

export const sensorIdParamSchema = z.object({
  id: z.string().uuid(),
});
