import { Request, Response, NextFunction } from "express";
import * as estacaoService from "../services/estacao.service";
import { AppError } from "../middlewares/error-handler";

interface AuthenticatedRequest extends Request {
  usuario?: {
    id: string;
    papel: string;
    municipio: string;
  };
}

export const create = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const papel = req.usuario?.papel || (req.usuario as any)?.role;

    let municipio: string | undefined;

    if (papel === "GESTOR_PUBLICO") {
      municipio = req.usuario?.municipio;
    } else if (papel === "ADMINISTRADOR") {
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
    const estacoes = await estacaoService.findAll(req.usuario);
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
      req.usuario,
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
      req.usuario,
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
      req.usuario,
    );
    return res.json(estacao);
  } catch (err) {
    next(err);
  }
};

export const status = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const usuario = req.usuario;
    const papel = usuario?.papel;
    let municipio = usuario?.municipio;

    // Se for ADMINISTRADOR, aceita o município enviado via Query String (?municipio=...)
    if (papel === "ADMINISTRADOR") {
      municipio = (req.query.municipio as string) || municipio;
    }

    if (!municipio) {
      throw new AppError(
        "O parâmetro de município é obrigatório para consultar o status.",
        400,
      );
    }

    const resultado = await estacaoService.getStatusPorMunicipio(municipio);

    return res.status(200).json(resultado);
  } catch (err) {
    next(err);
  }
};
