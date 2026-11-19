/**
 * Log das mensagens duplicadas ignoradas (TASK 13.02).
 * Duplicata não é erro nem rejeição: com QoS 1 o broker pode reenviar a mesma
 * mensagem, então o log é INFO. O contador fica no Valkey
 * (staging:contador:duplicadas), separado do de recusadas.
 */

import { logger, Logger } from "../utils/logger";

export const MENSAGEM_DUPLICADA_IGNORADA = "Leitura duplicada ignorada";

export interface DadosDuplicada {
  estacaoId: string;
  timestamp: string;
}

export interface RegistroDuplicadaDeps {
  logger?: Pick<Logger, "info">;
}

export function registrarDuplicadaIgnorada(
  dados: DadosDuplicada,
  deps: RegistroDuplicadaDeps = {},
): void {
  (deps.logger ?? logger).info(MENSAGEM_DUPLICADA_IGNORADA, {
    estacaoId: dados.estacaoId,
    timestamp: dados.timestamp,
  });
}

export default registrarDuplicadaIgnorada;
