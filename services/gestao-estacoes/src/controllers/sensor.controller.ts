import { Request, Response, NextFunction } from "express";
import * as sensorService from "../services/sensor.service";

export const create = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { estacaoId } = req.params as { estacaoId: string };
    const usuario = req.usuario!;

    const sensor = await sensorService.create(estacaoId, usuario, req.body);
    res.status(201).json(sensor);
  } catch (err) {
    next(err);
  }
};

export const listByEstacao = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { estacaoId } = req.params as { estacaoId: string };
    const usuario = req.usuario!;

    const sensores = await sensorService.listByEstacao(estacaoId, usuario);
    res.json(sensores);
  } catch (err) {
    next(err);
  }
};

export const update = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params as { id: string };
    const usuario = req.usuario!;

    const sensor = await sensorService.update(id, usuario, req.body);
    res.json(sensor);
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
    const usuario = req.usuario!;
    const { status } = req.body;

    const sensor = await sensorService.updateStatus(id, usuario, status);
    res.json(sensor);
  } catch (err) {
    next(err);
  }
};
