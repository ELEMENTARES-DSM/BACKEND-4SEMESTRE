import { Request, Response, NextFunction } from "express";
import * as estacaoService from "../services/estacao.service";

export const status = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const municipio = req.usuario!.municipio;

    const resultado = await estacaoService.getStatusPorMunicipio(municipio);
    res.json(resultado);
  } catch (err) {
    next(err);
  }
};
