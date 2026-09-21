import { Request, Response, NextFunction } from "express";
import * as estacaoService from "../services/estacao.service";
import { AppError } from "../middlewares/error-handler";

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    papel: string;
    municipio: string;
  };
}

export const create = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    let municipio: string | undefined;

    if (req.user?.papel === "GESTOR_PUBLICO") {
      municipio = req.user.municipio;
    } else if (req.user?.papel === "ADMINISTRADOR") {
      municipio = req.body.municipio;
    } else {
      throw new AppError("Perfil não autorizado para cadastrar estações", 403);
    }

    if (!municipio) {
      throw new AppError(
        "O município é obrigatório para o cadastro da estação",
        400,
      );
    }

    const novaEstacao = await estacaoService.create({
      ...req.body,
      municipio,
    });

    return res.status(201).json(novaEstacao);
  } catch (err) {
    next(err);
  }
};

export const findAll = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const estacoes = await estacaoService.findAll(req.user);
    return res.json(estacoes);
  } catch (err) {
    next(err);
  }
};

export const findById = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const estacao = await estacaoService.findById(
      req.params.id as string,
      req.user,
    );
    return res.json(estacao);
  } catch (err) {
    next(err);
  }
};

export const update = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const estacao = await estacaoService.update(
      req.params.id as string,
      req.body,
      req.user,
    );
    return res.json(estacao);
  } catch (err) {
    next(err);
  }
};

export const updateStatus = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const estacao = await estacaoService.updateStatus(
      req.params.id as string,
      req.body.status,
      req.user,
    );
    return res.json(estacao);
  } catch (err) {
    next(err);
  }
};
