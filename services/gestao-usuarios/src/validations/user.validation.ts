import { z } from "zod";

export const createUserSchema = z.object({
  nome: z.string().min(2).max(120),
  email: z.string().email().max(150),
  senha: z.string().min(8).max(72), // bcrypt trunca acima de 72 bytes
  papel_id: z.string().uuid(),
  municipio: z.string().max(100).optional(),
});

export const updateUserSchema = z.object({
  nome: z.string().min(2).max(120).optional(),
  email: z.string().email().max(150).optional(),
  municipio: z.string().max(100).optional(),
  papel_id: z.string().uuid().optional(),
  esta_ativo: z.boolean().optional(),
});

export const userIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const updateStatusSchema = z.object({
  esta_ativo: z.boolean(),
});