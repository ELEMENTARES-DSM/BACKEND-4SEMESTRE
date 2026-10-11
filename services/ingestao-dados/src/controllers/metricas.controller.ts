import { Request, Response } from "express";
import { rejectionMetricsService } from "../services/rejection-metrics.service";

export const obterMetricas = (_req: Request, res: Response): void => {
  const metricas = rejectionMetricsService.obterMetricas();
  const leiturasRejeitadas = metricas ?? {};

  res.status(200).json({
    leiturasRejeitadas,
  });
};

export default {
  obterMetricas,
};
