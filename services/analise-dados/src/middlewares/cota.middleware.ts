import { Request, Response, NextFunction } from "express";
import { verificarEDebitarCota } from "../services/cota.service";

/**
 * Middleware para aplicação de cotas e registro de rastro (auditoria)
 * em todas as requisições autenticadas às rotas de dados.
 */
export async function aplicarCotaEAuditar(
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Apenas requisições com token contam cota e deixam rastro
  if (!req.auth) {
    return next();
  }

  const { id: usuarioId, papel, municipio } = req.auth;
  const rota = req.originalUrl || req.url;
  const periodo = typeof req.query.periodo === "string" ? req.query.periodo : "24h";

  // Registro de rastro em log estruturado (Requisito US-42 / Cenário 7)
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      evento: "requisicao_dados",
      usuarioId,
      papel,
      rota,
      municipio: municipio || null,
      periodo,
    })
  );

  // Rotas de status de estações e alarmes ativos não debitam cota
  const rotaLower = rota.toLowerCase();
  const isRotaIsenta =
    rotaLower.includes("/status") || rotaLower.includes("/alarmes");

  if (isRotaIsenta) {
    return next();
  }

  try {
    const resultado = await verificarEDebitarCota(usuarioId, papel);

    if (!resultado.permitido) {
      res.setHeader("X-Cota-Semana-Restante", String(resultado.semanaRestante ?? 0));
      res.setHeader("X-Cota-Mes-Restante", String(resultado.mesRestante ?? 0));
      return res.status(429).json({
        erro: `Limite de cota ${resultado.motivo === "semana" ? "semanal" : "mensal"} de requisições excedido para o seu perfil.`,
        renovaEm: resultado.renovaEm,
        semanaRestante: resultado.semanaRestante,
        mesRestante: resultado.mesRestante,
      });
    }

    if (resultado.semanaRestante !== undefined) {
      res.setHeader("X-Cota-Semana-Restante", String(resultado.semanaRestante));
    }
    if (resultado.mesRestante !== undefined) {
      res.setHeader("X-Cota-Mes-Restante", String(resultado.mesRestante));
    }

    return next();
  } catch (err) {
    // Falhas de infraestrutura no valkey não devem interromper o serviço
    console.error("[Cota] Erro ao verificar cota no Valkey:", err);
    return next();
  }
}
