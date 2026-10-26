import { z } from "zod";

export const QUANTIDADE_INVALIDA = "Quantidade inválida";

// US-20: `quantidade` é opcional; quando vem, precisa ser inteiro maior que zero.
export const reenvioDlqSchema = z.object({
  quantidade: z.number().int().positive().optional(),
});

export type ReenvioDlqDTO = z.infer<typeof reenvioDlqSchema>;
