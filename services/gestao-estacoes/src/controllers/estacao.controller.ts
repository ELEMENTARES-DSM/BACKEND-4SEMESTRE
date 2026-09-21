import { Request, Response, NextFunction } from "express";
import * as estacaoService from "../services/estacao.service";

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    papel: string;
    municipio: string;
  };
}

export const create = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const payload = {
      ...req.body,
      municipio: req.user?.papel === "ADMINISTRADOR" ? req.body.municipio : req.user?.municipio,
    };

    const estacao = await estacaoService.create(payload);
    res.status(201).json(estacao);
  } catch (err) {
    next(err);
  }
};

export const findAll = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    // Gestor público apenas consulta a sua própria cidade; Administrador vê todas
    const estacoes = await estacaoService.findAll({
      papel: req.user?.papel,
      municipio: req.user?.municipio,
    });
    res.json(estacoes);
  } catch (err) {
    next(err);
  }
};

export const findById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const estacao = await estacaoService.findById(req.params.id as string);
    res.json(estacao);
  } catch (err) {
    next(err);
  }
};

export const update = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const estacao = await estacaoService.update(req.params.id as string, req.body);
    res.json(estacao);
  } catch (err) {
    next(err);
  }
};

// Inativação Lógica (Soft Delete) - Troca o status para 'Inativa'
export const inativar = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const estacao = await estacaoService.inativar(req.params.id as string);
    res.json(estacao);
  } catch (err) {
    next(err);
  }
};