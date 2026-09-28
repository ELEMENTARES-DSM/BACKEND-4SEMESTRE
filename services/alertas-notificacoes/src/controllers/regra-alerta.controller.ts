import { Request, Response, NextFunction } from "express";
import * as regraAlertaService from "../services/regra-alerta.service";

export const create = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const regra = await regraAlertaService.create(req.usuario!, req.body);
    res.status(201).json(regra);
  } catch (err) {
    next(err);
  }
};

export const list = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const regras = await regraAlertaService.list(req.usuario!);
    res.json(regras);
  } catch (err) {
    next(err);
  }
};

export const updateStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params as { id: string };
    const { status } = req.body;

    const regra = await regraAlertaService.updateStatus(
      id,
      req.usuario!,
      status
    );
    res.json(regra);
  } catch (err) {
    next(err);
  }
};
