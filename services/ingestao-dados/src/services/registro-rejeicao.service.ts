/**
 * Este é o ponto de encaixe: a US-12 vai chamar essa função quando rejeitar uma leitura.
 */

import { logger, Logger } from "../utils/logger";
import {
  rejectionMetricsService,
  RejectionMetricsService,
} from "./rejection-metrics.service";

export interface RegistroRejeicaoDeps {
  logger?: Pick<Logger, "warn"> | Logger;
  metricas?: Pick<RejectionMetricsService, "incrementarRejeicao"> | RejectionMetricsService;
}

export function registrarRejeicao(
  motivo: string,
  estacaoIdOrDeps?: string | RegistroRejeicaoDeps,
  talvezDeps?: RegistroRejeicaoDeps,
): void {
  let estacaoId: string | undefined;
  let deps: RegistroRejeicaoDeps;

  if (typeof estacaoIdOrDeps === "object" && estacaoIdOrDeps !== null) {
    estacaoId = undefined;
    deps = estacaoIdOrDeps;
  } else {
    estacaoId = estacaoIdOrDeps;
    deps = talvezDeps ?? {};
  }

  const log = deps.logger ?? logger;
  const metricas = deps.metricas ?? rejectionMetricsService;

  if (estacaoId !== undefined) {
    log.warn(motivo, { estacaoId });
  } else {
    log.warn(motivo);
  }

  metricas.incrementarRejeicao(motivo);
}

export default registrarRejeicao;
