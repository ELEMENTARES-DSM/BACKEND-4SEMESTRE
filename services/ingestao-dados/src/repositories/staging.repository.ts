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
