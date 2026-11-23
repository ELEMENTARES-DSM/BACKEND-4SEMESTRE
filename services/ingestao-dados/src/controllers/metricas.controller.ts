import { Request, Response } from "express";
import { lerMetricas } from "../repositories/staging-valkey.repository";

// Contadores da US-21 lidos do Valkey (TASK 40.05): não zeram ao reiniciar.
export const obterMetricas = async (_req: Request, res: Response): Promise<void> => {
  try {
    res.status(200).json(await lerMetricas());
  } catch {
    res.status(500).json({ erro: "Não foi possível consultar métricas de ingestão." });
  }
};

export default {
  obterMetricas,
};
