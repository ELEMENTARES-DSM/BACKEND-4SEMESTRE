import { Request, Response } from "express";
import { rejectionMetricsService } from "../services/rejection-metrics.service";
import { duplicateMetricsService } from "../services/duplicate-metrics.service";
import { receivedMetricsService } from "../services/received-metrics.service";

export const obterMetricas = (_req: Request, res: Response): void => {
  const metricas = rejectionMetricsService.obterMetricas();
  const leiturasRejeitadas = metricas ?? {};

  res.status(200).json({
    leiturasRecebidas: receivedMetricsService.obterTotal(),
    leiturasRejeitadas,
    duplicadasIgnoradas: duplicateMetricsService.obterTotal(),
  });
};

export default {
  obterMetricas,
};
