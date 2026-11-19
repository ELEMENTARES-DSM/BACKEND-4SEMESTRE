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

export const cadastroMunicipeSchema = z.object({
  nome: z.string().trim().min(2, "Nome deve ter no mínimo 2 caracteres").max(120, "Nome deve ter no máximo 120 caracteres"),
  email: z.string().trim().toLowerCase().email("E-mail inválido").max(150, "E-mail deve ter no máximo 150 caracteres"),
  senha: z
    .string()
    .min(8, "Senha deve ter no mínimo 8 caracteres")
    .max(72, "Senha deve ter no máximo 72 caracteres")
    .regex(/[A-Z]/, "Senha deve conter pelo menos uma letra maiúscula")
    .regex(/[a-z]/, "Senha deve conter pelo menos uma letra minúscula")
    .regex(/[0-9]/, "Senha deve conter pelo menos um dígito numérico")
    .regex(/[^a-zA-Z0-9]/, "Senha deve conter pelo menos um caractere especial"),
  municipio: z.string().trim().max(100, "Município deve ter no máximo 100 caracteres").optional(),
  aceite_privacidade: z.literal(true, {
    message: "O aceite do aviso de privacidade é obrigatório",
  }),
});