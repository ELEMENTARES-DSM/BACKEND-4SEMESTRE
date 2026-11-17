import { z } from "zod";
import { AGREGACOES_TIPO_SENSOR } from "../models/tipo-sensor.model";

// Limite do NUMERIC(12,2) das faixas: acima disso o banco responderia erro 500.
const LIMITE_FAIXA = 9999999999.99;

// NUMERIC(12,2) guarda 2 casas: com mais, o banco arredondaria em silêncio e
// poderia até igualar mínimo e máximo (violando o CHECK).
const temNoMaximoDuasCasas = (valor: number) =>
  Math.abs(valor * 100 - Math.round(valor * 100)) < 1e-6;

const limiteDeFaixa = z
  .number()
  .min(-LIMITE_FAIXA)
  .max(LIMITE_FAIXA)
  .refine(temNoMaximoDuasCasas, { message: "Use no máximo 2 casas decimais." });

export const createTipoSensorSchema = z.object({
  nome: z.string().trim().min(1).max(100),
  unidade: z.string().trim().min(1).max(20),
  faixa_min: limiteDeFaixa,
  faixa_max: limiteDeFaixa,
  agregacao: z.enum(AGREGACOES_TIPO_SENSOR).default("media"),
});
