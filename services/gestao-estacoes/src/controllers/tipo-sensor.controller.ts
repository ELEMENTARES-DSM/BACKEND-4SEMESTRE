import { Request, Response, NextFunction } from "express";
import * as tipoSensorService from "../services/tipo-sensor.service";

export const listar = async (
  _req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const tipos = await tipoSensorService.listar();
    res.json(tipos);
  } catch (err) {
    next(err);
  }
};

export const atualizar = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params as { id: string };
    const tipo = await tipoSensorService.atualizar(id, req.body);
    res.json(tipo);
  } catch (err) {
    next(err);
  }
};

export const excluir = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params as { id: string };
    await tipoSensorService.excluir(id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

export const criar = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const tipo = await tipoSensorService.criar(req.body);
    res.status(201).json(tipo);
  } catch (err) {
    next(err);
  }
};
