import type { ChannelModel } from "amqplib";
import type { Pool } from "pg";
import type { Destinos, EventoDlq, MedidasDoStaging, StagingRow } from "./balanco.js";
import type { MensagemLote } from "./manifesto.js";

export const FILA_VALIDACAO_DLQ = "validacao.dlq";

/** Linhas do staging e medidas das mensagens do lote (só leitura). */
export async function lerBanco(pool: Pool, manifesto: MensagemLote[]): Promise<Omit<Destinos, "dlq">> {
  const estacoes = [...new Set(manifesto.map((m) => m.estacao_uuid))];
  const horarios = [...new Set(manifesto.map((m) => m.unixtime))];
  const conteudos = manifesto.map((m) => m.payload_bruto);

  const staging = await pool.query<StagingRow>(
    `SELECT id, estacao_uuid, unixtime::float8 AS unixtime, status, motivo_rejeicao, payload_bruto
     FROM staging_telemetria
     WHERE estacao_uuid = ANY($1::uuid[])
       AND (unixtime = ANY($2::bigint[]) OR payload_bruto = ANY($3::text[]))`,
    [estacoes, horarios, conteudos],
  );

  const ids = staging.rows.map((linha) => linha.id);
  const medidas = await pool.query<MedidasDoStaging>(
    `SELECT staging_id,
            count(*) FILTER (WHERE valida)::int AS validas,
            count(*) FILTER (WHERE NOT valida)::int AS invalidas
     FROM medidas
     WHERE staging_id = ANY($1::uuid[])
     GROUP BY staging_id`,
    [ids],
  );

  return { staging: staging.rows, medidas: medidas.rows };
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
