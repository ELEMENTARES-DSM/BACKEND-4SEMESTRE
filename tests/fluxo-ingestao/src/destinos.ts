import type { ChannelModel } from "amqplib";
import type { Pool } from "pg";
import type { createClient } from "redis";
import type { MedidasDoStaging, EventoDlq, MensagemStaging } from "./balanco.js";
import type { MensagemLote } from "./manifesto.js";

export const FILA_VALIDACAO_DLQ = "validacao.dlq";
const PREFIXO_MENSAGEM = "staging:msg:";

type ClienteValkey = Pick<ReturnType<typeof createClient>, "scanIterator" | "hmGet">;

/** UUID da estação no tópico pulso/estacoes/{uuid}/telemetria. */
export function estacaoDoTopico(topico: string | null | undefined): string | null {
  return /^pulso\/estacoes\/([^/]+)\/telemetria$/.exec(topico ?? "")?.[1] ?? null;
}

/**
 * Mensagens das estações do lote no Valkey (só leitura). As decididas ficam
 * 7 dias lá; recebida e pendente ficam até sair.
 * ponytail: SCAN em todo staging:msg:*, O(mensagens dos últimos 7 dias) por
 * volta da espera. Basta para o teste; um índice por estação só se o modo
 * contínuo rodar dias seguidos.
 */
export async function lerValkey(cliente: ClienteValkey, manifesto: MensagemLote[]): Promise<MensagemStaging[]> {
  const estacoes = new Set(manifesto.map((m) => m.estacao_uuid));
  const chaves: string[] = [];
  for await (const chave of cliente.scanIterator({ MATCH: `${PREFIXO_MENSAGEM}*`, COUNT: 1000 })) {
    chaves.push(chave);
  }

  // O cliente junta os comandos simultâneos num pipeline só.
  const campos = await Promise.all(
    chaves.map((chave) => cliente.hmGet(chave, ["topico", "conteudo", "status", "motivo"])),
  );
  return chaves
    .map((chave, i) => {
      const [topico, conteudo, status, motivo] = campos[i];
      return {
        id: chave.slice(PREFIXO_MENSAGEM.length),
        estacao_uuid: estacaoDoTopico(topico),
        status: status ?? "",
        motivo: motivo ?? null,
        payload_bruto: conteudo ?? "",
      };
    })
    // Sem status a chave expirou entre o SCAN e a leitura.
    .filter((m) => m.status !== "" && m.estacao_uuid !== null && estacoes.has(m.estacao_uuid));
}

/** Medidas gravadas pelo servico-validacao para as mensagens encaminhadas (só leitura). */
export async function lerMedidas(pool: Pool, stagingIds: string[]): Promise<MedidasDoStaging[]> {
  const medidas = await pool.query<MedidasDoStaging>(
    `SELECT staging_id,
            count(*) FILTER (WHERE valida)::int AS validas,
            count(*) FILTER (WHERE NOT valida)::int AS invalidas
     FROM medidas
     WHERE staging_id = ANY($1::uuid[])
     GROUP BY staging_id`,
    [stagingIds],
  );
  return medidas.rows;
}

/**
 * Lê a validacao.dlq sem consumir: pega as mensagens sem confirmar e fecha o
 * canal, o que devolve todas à fila.
 */
export async function espiarDlq(conexao: ChannelModel): Promise<EventoDlq[]> {
  const canal = await conexao.createChannel();
  try {
    const { messageCount } = await canal.checkQueue(FILA_VALIDACAO_DLQ);
    const eventos: EventoDlq[] = [];
    for (let i = 0; i < messageCount; i++) {
      const msg = await canal.get(FILA_VALIDACAO_DLQ, { noAck: false });
      if (!msg) {
        break;
      }
      try {
        eventos.push(JSON.parse(msg.content.toString("utf-8")) as EventoDlq);
      } catch {
        // Conteúdo que não é JSON não é de nenhum lote.
      }
    }
    return eventos;
  } finally {
    await canal.close().catch(() => undefined);
  }
}
