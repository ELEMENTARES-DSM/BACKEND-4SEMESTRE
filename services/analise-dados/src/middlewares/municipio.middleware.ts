import { Request, Response, NextFunction } from "express";
import { PERFIS } from "../config/limites-periodo";

/**
 * Middleware para isolamento territorial do GESTOR_PUBLICO.
 * Garante que o gestor só consulte dados referentes ao seu município.
 */
export function verificarMunicipio(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const usuario = req.auth;

  if (!usuario) {
    return next();
  }

  const municipioSolicitado = req.query.municipio;

  if (
    municipioSolicitado !== undefined &&
    typeof municipioSolicitado !== "string"
  ) {
    return res.status(400).json({
      erro: "Parâmetro de município inválido.",
    });
  }

  if (usuario.papel === PERFIS.ADMINISTRADOR) {
    if (typeof municipioSolicitado === "string") {
      req.municipioEscopo = municipioSolicitado;
    }
    return next();
  }

  if (usuario.papel !== PERFIS.GESTOR_PUBLICO) {
    return next();
  }

  if (!usuario.municipio) {
    return res.status(403).json({
      erro: "Gestor sem município associado.",
    });
  }

  if (
    typeof municipioSolicitado === "string" &&
    municipioSolicitado.trim().toLowerCase() !== usuario.municipio.trim().toLowerCase()
  ) {
    return res.status(404).json({
      erro: "Recurso não encontrado.",
    });
  }

  req.municipioEscopo = usuario.municipio;

  return next();
}
