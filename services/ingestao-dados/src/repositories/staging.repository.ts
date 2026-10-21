import { randomUUID } from "node:crypto";
import { PoolClient } from "pg";
import { pool } from "../config/db";

export interface RegistroStaging {
  estacaoId: string;
  unixtime: number | null;
  recebidoEm: string;
  payloadBruto: string;
  payloadJson: string | null;
  status: "recebida" | "rejeitada";
  motivoRejeicao: string | null;
}

export interface MensagemPendente {
  id: string;
  estacao_uuid: string;
  unixtime: string;
  payload: { leituras?: Array<{ sensor: string; valor: number }> };
}

export interface BloqueioPublicador {
  liberar(): Promise<void>;
}

const CHAVE_BLOQUEIO_PUBLICADOR = "ingestao-dados.staging-telemetria.publisher";

/** Coordena o lote inteiro entre instâncias sem manter estado de mensagens em memória. */
export async function tentarBloquearPublicador(): Promise<BloqueioPublicador | null> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ adquirido: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1), 0) AS adquirido",
      [CHAVE_BLOQUEIO_PUBLICADOR],
    );
    if (!rows[0]?.adquirido) {
      client.release();
      return null;
    }

    let liberado = false;
    return {
      liberar: async () => {
        if (liberado) return;
        liberado = true;
        try {
          await client.query(
            "SELECT pg_advisory_unlock(hashtext($1), 0)",
            [CHAVE_BLOQUEIO_PUBLICADOR],
          );
        } finally {
          client.release();
        }
      },
    };
  } catch (erro) {
    client.release();
    throw erro;
  }
}

/** Reserva uma mensagem por vez para preservar ordem e evitar concorrência entre instâncias. */
export async function reservarProximaPendente(): Promise<MensagemPendente | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<MensagemPendente>(`
      SELECT id, estacao_uuid, unixtime, payload
      FROM staging_telemetria
      WHERE status IN ('recebida', 'pendente') AND processando = FALSE
      ORDER BY criado_em ASC, id ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `);
    if (!rows[0]) {
      await client.query("COMMIT");
      return null;
    }
    await client.query(
      "UPDATE staging_telemetria SET processando = TRUE WHERE id = $1",
      [rows[0].id],
    );
    await client.query("COMMIT");
    return rows[0];
  } catch (erro) {
    await client.query("ROLLBACK");
    throw erro;
  } finally {
    client.release();
  }
}

export async function marcarPublicada(id: string): Promise<void> {
  await pool.query(`
    UPDATE staging_telemetria
    SET status = 'publicada', processado_em = NOW(), processando = FALSE,
        ultimo_erro = NULL
    WHERE id = $1
  `, [id]);
}

export async function marcarPendente(id: string, motivo: string): Promise<void> {
  await pool.query(`
    UPDATE staging_telemetria
    SET status = 'pendente', processando = FALSE, tentativas = tentativas + 1,
        ultimo_erro = $2
    WHERE id = $1
  `, [id, motivo.slice(0, 4000)]);
}

/** Move mensagens ainda não reservadas para pendente quando o broker está indisponível. */
export async function marcarRecebidasPendentes(motivo: string): Promise<void> {
  await pool.query(`
    UPDATE staging_telemetria
    SET status = 'pendente', tentativas = tentativas + 1, ultimo_erro = $1
    WHERE status = 'recebida' AND processando = FALSE
  `, [motivo.slice(0, 4000)]);
}

export async function contarPendentes(): Promise<number> {
  const { rows } = await pool.query<{ total: string }>(`
    SELECT COUNT(*) AS total FROM staging_telemetria
    WHERE status IN ('recebida', 'pendente')
  `);
  return Number(rows[0]?.total ?? 0);
}

export async function liberarReservasAbandonadas(): Promise<void> {
  await pool.query(`
    UPDATE staging_telemetria SET processando = FALSE
    WHERE status IN ('recebida', 'pendente') AND processando = TRUE
  `);
}

export async function inserirStaging(
  registro: RegistroStaging,
  client?: PoolClient,
): Promise<boolean> {
  const executor = client ?? pool;

  const resultado = await executor.query<{ id: string }>(
    `
      INSERT INTO staging_telemetria (
        id,
        estacao_uuid,
        unixtime,
        criado_em,
        payload_bruto,
        payload,
        status,
        motivo_rejeicao
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
      ON CONFLICT (estacao_uuid, unixtime)
        WHERE status <> 'rejeitada'
      DO NOTHING
      RETURNING id
    `,
    [
      randomUUID(),
      registro.estacaoId,
      registro.unixtime,
      registro.recebidoEm,
      registro.payloadBruto,
      registro.payloadJson,
      registro.status,
      registro.motivoRejeicao,
    ],
  );

  return resultado.rows.length > 0;
}
