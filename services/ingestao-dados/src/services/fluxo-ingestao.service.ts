/**
 * Fluxo esperado de uma mensagem:
 *   MQTT (US-11) → validações (US-12) → encaminharSeNova (13.01) → US-14
 * A US-14 grava as leituras e atualiza ultimo_ping. Como ultimo_ping só é
 * atualizado na US-14, a mensagem duplicada nunca chega lá.
 *
 * seguirParaUS14 é obrigatório: a US-14 ainda não existe e vai ser plugada
 * aqui pelo consumidor MQTT.
 */

import { PayloadLeituraValidado } from "../dto/mensagem-ingestao.dto";
import { removerReserva } from "../repositories/mensagem-staging.repository";
import { reservarMensagem } from "./deduplicacao.service";

export type SeguirParaUS14 = (mensagem: {
  estacaoId: string;
  stagingId: string;
  payload: PayloadLeituraValidado;
}) => Promise<void>;

export interface FluxoIngestaoDeps {
  seguirParaUS14: SeguirParaUS14;
  reservar?: typeof reservarMensagem;
  remover?: (stagingId: string) => Promise<void>;
}

export type ResultadoEncaminhamento =
  | { resultado: "nova"; stagingId: string }
  | { resultado: "duplicada" };

export async function encaminharSeNova(
  estacaoId: string,
  payload: PayloadLeituraValidado,
  deps: FluxoIngestaoDeps,
): Promise<ResultadoEncaminhamento> {
  const reservar = deps.reservar ?? reservarMensagem;
  const remover = deps.remover ?? removerReserva;
  const reserva = await reservar(estacaoId, payload);

  if (!reserva.nova) {
    // TASK 13.02: registrar log e contador da duplicata aqui
    return { resultado: "duplicada" };
  }

  try {
    await deps.seguirParaUS14({ estacaoId, stagingId: reserva.stagingId, payload });
  } catch (erro) {
    // Com QoS 1 o broker reenvia a mensagem que falhou. Se a reserva ficasse
    // na staging, o reenvio seria descartado como duplicata e a leitura se perderia.
    // Falha na remoção não pode esconder o erro original da US-14.
    try {
      await remover(reserva.stagingId);
    } catch {
      // ignorado de propósito: o erro relançado é o da US-14
    }
    throw erro;
  }

  return { resultado: "nova", stagingId: reserva.stagingId };
}
