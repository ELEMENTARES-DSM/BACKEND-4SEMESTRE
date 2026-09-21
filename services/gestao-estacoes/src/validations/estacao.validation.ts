import { z } from "zod";

export const createEstacaoSchema = z.object({
  codigo: z
    .string()
    .min(1, "Código é obrigatório")
    .max(30, "Máximo 30 caracteres"),
  nome: z
    .string()
    .min(2, "Nome  é obrigatório")
    .max(120, "Nome deve ter no mínimo 2 caracteres"),
  municipio: z
    .string()
    .min(1, "Município é obrigatório")
    .max(100, "Município deve ter no mínimo 1 caracteres"),

  latitude: z
    .number({ message: "Latitude deve ser um número" })
    .min(-90, "Coordenadas geográficas fora dos limites válidos")
    .max(90, "Coordenadas geográficas fora dos limites válidos"),

  longitude: z
    .number({ message: "Longitude deve ser um número" })
    .min(-180, "Coordenadas geográficas fora dos limites válidos")
    .max(180, "Coordenadas geográficas fora dos limites válidos"),

  status: z.string().max(20).optional(),
  nivel_bateria: z.number().min(0).max(100).nullable().optional(),
  ultimo_ping: z.coerce.date().nullable().optional(),
});

export const updateEstacaoSchema = z.object({
  nome: z.string().min(2).max(120).optional(),
  municipio: z.string().min(1).max(100).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  status: z.string().max(20).optional(),
  nivel_bateria: z.number().min(0).max(100).nullable().optional(),
  ultimo_ping: z.coerce.date().nullable().optional(),
});

export const estacaoIdParamSchema = z.object({
  id: z.string().uuid("ID inválido"),
});

export const updateStatusSchema = z.object({
  status: z.enum(["Ativa", "Inativa"], {
    message: "Status deve ser 'Ativa' ou 'Inativa'",
  }),
});
