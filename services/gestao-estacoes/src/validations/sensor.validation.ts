import { z } from "zod";

export const createSensorSchema = z.object({
  codigo: z.string().trim().min(1).max(30).optional(),
  nome: z.string().trim().min(1).max(100).optional(),
  // Nome de uma grandeza do catálogo; quem confere se existe é o service.
  tipo: z.string().trim().min(1).max(100),
  // Opcional. Vazio ou ausente significa "a placa já envia na unidade da grandeza".
  unidade_leitura: z
    .string()
    .trim()
    .max(20)
    .nullish()
    .transform((valor) => (valor ? valor : null)),
  // valor = bruto x fator_conversao + offset (padrão: fator 1 e offset 0).
  fator_conversao: z.number().optional(),
  offset: z.number().optional(),
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
