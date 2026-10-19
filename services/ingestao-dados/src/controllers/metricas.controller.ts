import { Request, Response } from "express";
import { rejectionMetricsService } from "../services/rejection-metrics.service";
import { duplicateMetricsService } from "../services/duplicate-metrics.service";
import { contarPendentes } from "../repositories/staging.repository";
import { receivedMetricsService } from "../services/received-metrics.service";

export const obterMetricas = async (_req: Request, res: Response): Promise<void> => {
  const metricas = rejectionMetricsService.obterMetricas();
  const leiturasRejeitadas = metricas ?? {};

  try {
    const mensagensPendentes = await contarPendentes();
    res.status(200).json({
      leiturasRejeitadas,
      duplicadasIgnoradas: duplicateMetricsService.obterTotal(),
      mensagensPendentes,
    });
  } catch {
    res.status(500).json({ erro: "Não foi possível consultar métricas de ingestão." });
  }
  res.status(200).json({
    leiturasRecebidas: receivedMetricsService.obterTotal(),
    leiturasRejeitadas,
    duplicadasIgnoradas: duplicateMetricsService.obterTotal(),
  });
};

export default {
  obterMetricas,
};
