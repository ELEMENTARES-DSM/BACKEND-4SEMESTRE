/**
 * Log da leitura recusada (US-12). O contador por motivo fica no Valkey
 * (staging:contador:recusadas:{motivo}), no mesmo MULTI que marca a recusa.
 */

import { logger, Logger } from "../utils/logger";

export interface RegistroRejeicaoDeps {
  logger?: Pick<Logger, "warn">;
}

export function registrarRejeicao(
  motivo: string,
  estacaoIdOrDeps?: string | RegistroRejeicaoDeps,
  talvezDeps?: RegistroRejeicaoDeps,
): void {
  const estacaoId = typeof estacaoIdOrDeps === "string" ? estacaoIdOrDeps : undefined;
  const deps = (typeof estacaoIdOrDeps === "object" ? estacaoIdOrDeps : talvezDeps) ?? {};
  const log = deps.logger ?? logger;

  if (estacaoId !== undefined) {
    log.warn(motivo, { estacaoId });
  } else {
    log.warn(motivo);
  }
}

export default registrarRejeicao;
