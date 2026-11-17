import { randomUUID } from "node:crypto";
import { valkey } from "../config/valkey";
import { MensagemBruta } from "../dto/mensagem-ingestao.dto";

// Staging no Valkey (US-40). Cada mensagem é um hash staging:msg:{id}; as
// listas guardam os ids na ordem de chegada.
export const LISTA_RECEBIDAS = "staging:recebidas";
export const LISTA_PENDENTES = "staging:pendentes";

export const chaveMensagem = (id: string): string => `staging:msg:${id}`;

// Encaminhada, recusada e duplicada expiram 7 dias depois de decididas.
// Recebida e pendente nunca expiram: ainda não chegaram ao RabbitMQ.
export const RETENCAO_MS = 7 * 24 * 60 * 60 * 1000;

export const expiraEm = (agora: Date): Date => new Date(agora.getTime() + RETENCAO_MS);

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

/**
 * Recusada ou duplicada: sai da fila de verificação, não segue para
 * telemetria.bruta e expira em 7 dias.
 */
export async function encerrarSemPublicar(
  id: string,
  status: "recusada" | "duplicada",
  agora: Date,
  motivo?: string,
): Promise<void> {
  await valkey()
    .multi()
    .hSet(chaveMensagem(id), motivo === undefined ? { status } : { status, motivo })
    .expireAt(chaveMensagem(id), expiraEm(agora))
    .lRem(LISTA_RECEBIDAS, 1, id)
    .exec();
}

export const chaveVisto = (estacaoId: string, unixtime: number): string =>
  `staging:visto:${estacaoId}:${unixtime}`;

/**
 * Duplicata (US-13): marca estação + horário como vistos por 7 dias com um
 * único SET NX GET. O valor é o id da mensagem, para a mesma mensagem
 * verificada de novo depois de uma falha no meio do caminho não virar
 * duplicata de si mesma. Depois dos 7 dias, a repetição é barrada pelo índice
 * único de medidas (US-17).
 */
export async function marcarVisto(
  estacaoId: string,
  unixtime: number,
  id: string,
  agora: Date,
): Promise<"nova" | "duplicada"> {
  const anterior = await valkey().set(chaveVisto(estacaoId, unixtime), id, {
    NX: true,
    GET: true,
    PXAT: expiraEm(agora).getTime(),
  });
  return anterior === null || anterior === id ? "nova" : "duplicada";
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

/** Próxima a publicar, sem tirar da lista: só sai depois da confirmação do RabbitMQ. */
export async function proximaPendente(): Promise<string | null> {
  return valkey().lIndex(LISTA_PENDENTES, 0);
}

/**
 * Confirmada pelo RabbitMQ: status "encaminhada", expira em 7 dias e sai da
 * lista pelo id (LREM, não LPOP), para nunca tirar outro id da frente.
 */
export async function marcarEncaminhada(id: string, agora: Date): Promise<void> {
  await valkey()
    .multi()
    .hSet(chaveMensagem(id), { status: "encaminhada" })
    .expireAt(chaveMensagem(id), expiraEm(agora))
    .lRem(LISTA_PENDENTES, 1, id)
    .exec();
}

/** Id na lista sem a mensagem (apagada à mão): sai da lista para não travar a fila. */
export async function descartarPendente(id: string): Promise<void> {
  await valkey().lRem(LISTA_PENDENTES, 1, id);
}

export async function contarPendentes(): Promise<number> {
  return valkey().lLen(LISTA_PENDENTES);
}
