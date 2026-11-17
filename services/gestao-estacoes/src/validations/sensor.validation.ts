import { z } from "zod";

// É o código que a placa envia no payload MQTT; único por estação.
const codigoDoSensor = z.string().trim().min(1).max(30);

export const createSensorSchema = z.object({
  codigo: codigoDoSensor,
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

// No PUT o código é opcional: só é aceito para definir o de um sensor antigo que
// ainda não tem código, ou repetindo o atual (o service recusa a troca).
export const updateSensorSchema = createSensorSchema
  .omit({ codigo: true, nome: true })
  .extend({ codigo: codigoDoSensor.optional() });

export const updateSensorStatusSchema = z.object({
  status: z.enum(["Ativo", "Inativo"]),
});

export const estacaoIdParamSchema = z.object({
  estacaoId: z.string().uuid(),
});

export const sensorIdParamSchema = z.object({
  id: z.string().uuid(),
});
