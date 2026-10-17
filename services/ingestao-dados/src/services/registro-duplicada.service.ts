/**
 * Registro das mensagens duplicadas ignoradas (TASK 13.02).
 * Duplicata não é erro nem rejeição: com QoS 1 o broker pode reenviar a mesma
 * mensagem, então o log é INFO e o contador é separado do de rejeitadas.
 */

import { logger, Logger } from "../utils/logger";
import {
  duplicateMetricsService,
  DuplicateMetricsService,
} from "./duplicate-metrics.service";

export const MENSAGEM_DUPLICADA_IGNORADA = "Leitura duplicada ignorada";

export interface DadosDuplicada {
  estacaoId: string;
  timestamp: string;
}

export interface RegistroDuplicadaDeps {
  logger?: Pick<Logger, "info">;
  metricas?: Pick<DuplicateMetricsService, "incrementar">;
}

export function registrarDuplicadaIgnorada(
  dados: DadosDuplicada,
  deps: RegistroDuplicadaDeps = {},
): void {
  const log = deps.logger ?? logger;
  const metricas = deps.metricas ?? duplicateMetricsService;

  log.info(MENSAGEM_DUPLICADA_IGNORADA, {
    estacaoId: dados.estacaoId,
    timestamp: dados.timestamp,
  });
  metricas.incrementar();
}

export default registrarDuplicadaIgnorada;
