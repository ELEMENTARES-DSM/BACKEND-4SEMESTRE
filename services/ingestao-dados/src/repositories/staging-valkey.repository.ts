import { randomUUID } from "node:crypto";
import { valkey } from "../config/valkey";
import { MensagemBruta } from "../dto/mensagem-ingestao.dto";

// Staging no Valkey (US-40). Cada mensagem é um hash staging:msg:{id}; as
// listas guardam os ids na ordem de chegada.
export const LISTA_RECEBIDAS = "staging:recebidas";
export const LISTA_PENDENTES = "staging:pendentes";

export const chaveMensagem = (id: string): string => `staging:msg:${id}`;

export type StatusStaging = "recebida" | "recusada" | "duplicada" | "pendente" | "encaminhada";

export interface MensagemStaging extends MensagemBruta {
  id: string;
  status: StatusStaging;
  motivo?: string;
}

/**
 * Grava a mensagem exatamente como chegou, com status "recebida", e a coloca
 * no fim da fila de verificação. É a única coisa feita antes do PUBACK.
 */
export async function gravarBruta(mensagem: MensagemBruta): Promise<string> {
  const id = randomUUID();
  await valkey()
    .multi()
    .hSet(chaveMensagem(id), {
      topico: mensagem.topico,
      conteudo: mensagem.payloadBruto,
      recebidoEm: mensagem.recebidoEm,
      status: "recebida",
    })
    .rPush(LISTA_RECEBIDAS, id)
    .exec();
  return id;
}

export async function listarRecebidas(): Promise<string[]> {
  return valkey().lRange(LISTA_RECEBIDAS, 0, -1);
}

export async function lerMensagem(id: string): Promise<MensagemStaging | null> {
  const campos = await valkey().hGetAll(chaveMensagem(id));
  if (!campos.status) return null;
  return {
    id,
    topico: campos.topico,
    payloadBruto: campos.conteudo,
    recebidoEm: campos.recebidoEm,
    status: campos.status as StatusStaging,
    motivo: campos.motivo,
  };
}

/** Recusada ou duplicada: sai da fila de verificação e não segue para telemetria.bruta. */
export async function encerrarSemPublicar(
  id: string,
  status: "recusada" | "duplicada",
  motivo?: string,
): Promise<void> {
  await valkey()
    .multi()
    .hSet(chaveMensagem(id), motivo === undefined ? { status } : { status, motivo })
    .lRem(LISTA_RECEBIDAS, 1, id)
    .exec();
}

/** Aceita: entra no fim da lista de publicação. */
export async function marcarPendente(id: string): Promise<void> {
  await valkey()
    .multi()
    .hSet(chaveMensagem(id), { status: "pendente" })
    .rPush(LISTA_PENDENTES, id)
    .lRem(LISTA_RECEBIDAS, 1, id)
    .exec();
}
