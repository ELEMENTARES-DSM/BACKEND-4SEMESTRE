import { Request, Response } from "express";
import { sensorInativoMetricsService } from "../services/sensor-inativo-metrics.service";

export const obterMetricas = (_req: Request, res: Response): void => {
  res.status(200).json({
    leiturasIgnoradasSensorInativo: sensorInativoMetricsService.obterTotal(),
  });
};

export default {
  obterMetricas,
};
