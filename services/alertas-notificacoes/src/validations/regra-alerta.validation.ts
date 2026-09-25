import { z } from "zod";
import {
  OPERADORES_REGRA_ALERTA,
  SEVERIDADES_REGRA_ALERTA,
  STATUS_REGRA_ALERTA,
} from "../models/regra-alerta.model";

// Limites de NUMERIC(10,2).
const VALOR_LIMITE_MINIMO = -99999999.99;
const VALOR_LIMITE_MAXIMO = 99999999.99;

export const createRegraAlertaSchema = z.object({
  sensor_id: z.string().uuid(),
  nome: z.string().trim().min(1).max(100),
  operador: z.enum(OPERADORES_REGRA_ALERTA),
  valor_limite: z
    .number()
    .min(VALOR_LIMITE_MINIMO)
    .max(VALOR_LIMITE_MAXIMO),
  severidade: z.enum(SEVERIDADES_REGRA_ALERTA),
});

export const updateRegraAlertaStatusSchema = z.object({
  status: z.enum(STATUS_REGRA_ALERTA),
});

export const regraAlertaIdParamSchema = z.object({
  id: z.string().uuid(),
});

export type CreateRegraAlertaDTO = z.infer<typeof createRegraAlertaSchema>;
