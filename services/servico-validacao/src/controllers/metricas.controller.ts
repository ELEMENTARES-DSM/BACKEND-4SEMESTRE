import { Request, Response } from "express";
import { metricasValidacaoService } from "../services/metricas-validacao.service";

export const obterMetricas = (_req: Request, res: Response): void => {
  res.status(200).json(metricasValidacaoService.obterMetricas());
};

export default {
  obterMetricas,
};
