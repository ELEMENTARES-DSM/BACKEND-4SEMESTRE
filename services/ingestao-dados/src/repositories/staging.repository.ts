import { PoolClient } from "pg";
import { pool } from "../config/db";

export interface RegistroStaging {
  /** Mesmo id da mensagem no Valkey (staging:msg:{id}), que vira o staging_id das medidas. */
  id: string;
  estacaoId: string;
  unixtime: number | null;
  recebidoEm: string;
  payloadBruto: string;
  payloadJson: string | null;
  status: "recebida" | "rejeitada";
  motivoRejeicao: string | null;
}

export interface StagingPersistida {
  id: string;
  payload_bruto: string;
  status: string;
}

// US-40: a publicação lê do Valkey (staging-valkey.repository). Até a 40.04,
// a staging_telemetria só recebe a cópia de cada mensagem verificada.
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
      ON CONFLICT DO NOTHING
      RETURNING id
    `,
    [
      registro.id,
      registro.estacaoId,
      registro.unixtime,
      registro.recebidoEm,
      registro.payloadBruto,
      registro.payloadJson,
      registro.status,
      registro.motivoRejeicao,
    ],
  );

  if (resultado.rows.length > 0) return true;

  // Sem linha nova: ou é duplicata (uq_staging_estacao_unixtime), ou é a mesma
  // mensagem do Valkey verificada de novo depois de uma falha no meio do caminho.
  const mesma = await executor.query(
    "SELECT 1 FROM staging_telemetria WHERE id = $1",
    [registro.id],
  );
  return mesma.rows.length > 0;
}

/** Recupera a gravação original para republicar uma mensagem atrasada reenviada pelo MQTT. */
export async function buscarStagingPorEstacaoEUnixtime(
  estacaoId: string,
  unixtime: number,
): Promise<StagingPersistida | null> {
  const { rows } = await pool.query<StagingPersistida>(
    `SELECT id, payload_bruto, status
     FROM staging_telemetria
     WHERE estacao_uuid = $1 AND unixtime = $2 AND status <> 'rejeitada'
     LIMIT 1`,
    [estacaoId, unixtime],
  );
  return rows[0] ?? null;
}

export async function marcarStagingPublicada(id: string): Promise<void> {
  await pool.query(
    `UPDATE staging_telemetria
     SET status = 'publicada', processado_em = NOW(), processando = FALSE,
         ultimo_erro = NULL
     WHERE id = $1`,
    [id],
  );
}
