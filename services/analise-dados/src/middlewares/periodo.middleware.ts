import { Request, Response, NextFunction } from "express";
import {
  calcularDiasSolicitados,
  validarFormatoPeriodo,
  validarPeriodoPorPerfil,
} from "../config/limites-periodo";

/**
 * Middleware que valida se o período de tempo solicitado (via query params)
 * está dentro do limite concedido para o perfil do usuário logado (ou anônimo).
 *
 * Suporta:
 * - req.query.periodo (ex: '24h', '7d', '30d')
 * - req.query.data_inicio e req.query.data_fim (ISO string)
 * - req.query.inicio e req.query.fim
 */
export function verificarPeriodo(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (
    Array.isArray(req.query.periodo) ||
    Array.isArray(req.query.data_inicio) ||
    Array.isArray(req.query.data_fim) ||
    Array.isArray(req.query.inicio) ||
    Array.isArray(req.query.fim)
  ) {
    return res.status(400).json({
      erro: "Parâmetros de período repetidos não são permitidos.",
    });
  }

  const periodo = typeof req.query.periodo === "string" ? req.query.periodo : undefined;
  const dataInicio =
    typeof req.query.data_inicio === "string"
      ? req.query.data_inicio
      : typeof req.query.inicio === "string"
      ? req.query.inicio
      : undefined;
  const dataFim =
    typeof req.query.data_fim === "string"
      ? req.query.data_fim
      : typeof req.query.fim === "string"
      ? req.query.fim
      : undefined;

  const erroFormato = validarFormatoPeriodo(periodo, dataInicio, dataFim);
  if (erroFormato) {
    return res.status(400).json({ erro: erroFormato });
  }

  const diasSolicitados = calcularDiasSolicitados(periodo, dataInicio, dataFim);
  const papel = req.auth?.papel;

  const validacao = validarPeriodoPorPerfil(papel, diasSolicitados);

  if (!validacao.valido) {
    return res.status(400).json({
      erro: validacao.mensagemErro,
      limiteMaximoDias: validacao.limiteDias,
      diasSolicitados: validacao.diasSolicitados,
    });
  }

  return next();
}
