import { Request, Response, NextFunction } from "express";
import * as alarmeService from "../services/alarme.service";
import { listarAlarmesQuerySchema } from "../validations/alarme.validation";

export const list = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // No Express 5 req.query é só leitura: o filtro validado fica numa variável.
    const filtros = listarAlarmesQuerySchema.safeParse(req.query);
    if (!filtros.success) {
      return res.status(400).json({
        message: "Dados inválidos",
        errors: filtros.error.flatten().fieldErrors,
      });
    }

    const alarmes = await alarmeService.list(req.usuario!, filtros.data);
    res.json(alarmes);
  } catch (err) {
    next(err);
  }
};

export const resumo = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const resumoAbertos = await alarmeService.resumo(req.usuario!);
    res.json(resumoAbertos);
  } catch (err) {
    next(err);
  }
};

export const findById = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params as { id: string };

    const alarme = await alarmeService.findById(req.usuario!, id);
    res.json(alarme);
  } catch (err) {
    next(err);
  }
};
