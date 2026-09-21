import { z } from "zod";

export const createSensorSchema = z.object({
  codigo: z.string().min(1).max(50),
  nome: z.string().min(1).max(150),
  grandeza: z.string().min(1).max(100),
  unidade: z.string().min(1).max(20),
});

export const updateSensorStatusSchema = z.object({
  status: z.enum(["Ativo", "Inativo"]),
});

export const estacaoIdParamSchema = z.object({
  estacaoId: z.string().uuid(),
});

export const sensorIdParamSchema = z.object({
  id: z.string().uuid(),
});