import { z } from "zod";

// US-23: evento alarme.disparado publicado pelo servico-validacao (US-22).
// Valores decimais chegam como texto exato.
const decimal = z.string().regex(/^-?\d+(\.\d+)?$/);

export const eventoAlarmeSchema = z.object({
  alarme_id: z.string().uuid(),
  regra_id: z.string().uuid(),
  medida_id: z.string().uuid(),
  sensor_id: z.string().uuid(),
  estacao_id: z.string().uuid(),
  municipio: z.string().trim().min(1),
  valor: decimal,
  operador: z.enum([">", ">=", "<", "<=", "="]),
  limite: decimal,
  severidade: z.enum(["ATENCAO", "ALERTA", "CRITICO"]),
  lido_em: z.iso.datetime({ offset: true }),
  criado_em: z.iso.datetime({ offset: true }),
});

export type EventoAlarmeDisparado = z.infer<typeof eventoAlarmeSchema>;
