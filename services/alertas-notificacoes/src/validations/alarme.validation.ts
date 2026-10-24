import { z } from "zod";
import { SEVERIDADES_ALARME, SITUACOES_ALARME } from "../models/alarme.model";

// Datas com fuso (ISO 8601), como a tela envia: 2026-10-24T00:00:00.000-03:00.
const dataComFuso = z.iso.datetime({ offset: true });

export const listarAlarmesQuerySchema = z
  .object({
    de: dataComFuso.optional(),
    ate: dataComFuso.optional(),
    severidade: z.enum(SEVERIDADES_ALARME).optional(),
    estacao_id: z.string().uuid().optional(),
    situacao: z.enum(SITUACOES_ALARME).optional(),
  })
  .strict()
  .refine((f) => !f.de || !f.ate || Date.parse(f.de) <= Date.parse(f.ate), {
    message: "de deve ser anterior ou igual a ate",
    path: ["ate"],
  });

export const alarmeIdParamSchema = z.object({
  id: z.string().uuid(),
});

export type ListarAlarmesQuery = z.infer<typeof listarAlarmesQuerySchema>;
