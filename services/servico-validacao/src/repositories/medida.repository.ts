import { QueryResult } from "pg";
import { pool } from "../config/db";
import { MedidaRow, NovaMedidaInput } from "../dto/evento-telemetria.dto";
import { DbQueryable } from "./sensor.repository";

export interface ResultadoInsercaoMedida {
  inserida: boolean;
  medida: MedidaRow;
}

/**
 * Insere uma medida respeitando a idempotência UNIQUE (sensor_id, unixtime).
 * Se já existir um registro para o mesmo (sensor_id, unixtime), mantém o primeiro
 * e retorna o registro existente com `inserida: false`.
 */
export const inserirMedidaIdempotente = async (
  dados: NovaMedidaInput,
  db: DbQueryable = pool,
): Promise<ResultadoInsercaoMedida> => {
  const valida = dados.valida ?? true;
  const criadoEmUtcIso = dados.criado_em.toISOString();

  const insercao: QueryResult<MedidaRow> = await db.query<MedidaRow>(
    `INSERT INTO medidas (
       sensor_id,
       unixtime,
       valor_bruto,
       valor,
       valida,
       staging_id,
       criado_em
     )
     VALUES ($1, $2, $3, $4, $5, $6, ($7::timestamptz AT TIME ZONE 'UTC'))
     ON CONFLICT (sensor_id, unixtime) DO NOTHING
     RETURNING id, sensor_id, unixtime, valor_bruto, valor, valida, staging_id, criado_em`,
    [
      dados.sensor_id,
      dados.unixtime,
      dados.valor_bruto,
      dados.valor,
      valida,
      dados.staging_id,
      criadoEmUtcIso,
    ],
  );

  if (insercao.rows.length > 0) {
    return {
      inserida: true,
      medida: insercao.rows[0],
    };
  }

  const existente: QueryResult<MedidaRow> = await db.query<MedidaRow>(
    `SELECT id, sensor_id, unixtime, valor_bruto, valor, valida, staging_id, criado_em
     FROM medidas
     WHERE sensor_id = $1 AND unixtime = $2`,
    [dados.sensor_id, dados.unixtime],
  );

  if (existente.rows.length === 0) {
    throw new Error(
      `Falha ao localizar medida existente após conflito para sensor_id=${dados.sensor_id} e unixtime=${dados.unixtime}`,
    );
  }

  return {
    inserida: false,
    medida: existente.rows[0],
  };
};
