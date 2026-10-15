import { PayloadLeituraValidado } from "../dto/mensagem-ingestao.dto";
import { inserirSeNova } from "../repositories/mensagem-staging.repository";

export type ResultadoReserva =
  | { nova: true; stagingId: string }
  | { nova: false };

export interface DeduplicacaoDeps {
  inserirSeNova?: typeof inserirSeNova;
}

/**
 * Converte o timestamp da mensagem em segundos Unix (chave da duplicata).
 * Timestamps sem fuso são interpretados no TZ do processo; exigir fuso
 * explícito fica para a US-12.
 */
export function paraUnixtime(timestamp: string): number {
  const ms = Date.parse(timestamp);
  if (isNaN(ms)) {
    throw new Error(`Timestamp inválido: ${timestamp}`);
  }
  return Math.floor(ms / 1000);
}

/**
 * Reserva a mensagem na staging. Só o retorno null do repository significa
 * duplicata; erros do banco propagam.
 */
export async function reservarMensagem(
  estacaoId: string,
  payload: PayloadLeituraValidado,
  deps: DeduplicacaoDeps = {},
): Promise<ResultadoReserva> {
  const inserir = deps.inserirSeNova ?? inserirSeNova;

  const stagingId = await inserir({
    estacaoId,
    unixtime: paraUnixtime(payload.timestamp),
    timestampLeitura: new Date(Date.parse(payload.timestamp)),
    payload,
  });

  if (stagingId === null) {
    return { nova: false };
  }
  return { nova: true, stagingId };
}
