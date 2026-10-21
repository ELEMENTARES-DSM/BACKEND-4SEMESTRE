import { Pool, PoolClient, QueryResult } from "pg";
import { pool } from "../config/db";
import { SensorEventoRow } from "../dto/evento-telemetria.dto";

export type DbQueryable = Pick<Pool | PoolClient, "query">;

/**
 * Busca os sensores da estação correspondentes aos códigos informados no evento
 * em uma única consulta SQL, sem cache em memória, trazendo também o município
 * herdado da estação (sensores -> estacoes.municipio).
 */
export const buscarSensoresPorEvento = async (
  estacaoUuid: string,
  codigosSensores: string[],
  db: DbQueryable = pool,
): Promise<Map<string, SensorEventoRow>> => {
  const codigosUnicos = Array.from(new Set(codigosSensores));
  const mapa = new Map<string, SensorEventoRow>();

  if (codigosUnicos.length === 0) {
    return mapa;
  }

  const resultado: QueryResult<SensorEventoRow> = await db.query<SensorEventoRow>(
    `SELECT
       s.id,
       s.estacao_id,
       s.codigo,
       s.fator,
       s.ganho,
       s.status,
       e.municipio
     FROM sensores s
     JOIN estacoes e ON e.id = s.estacao_id
     WHERE s.estacao_id = $1
       AND s.codigo = ANY($2::varchar[])
     ORDER BY (s.status = 'Ativo') ASC`,
    [estacaoUuid, codigosUnicos],
  );

  // sensores.codigo não tem UNIQUE: se o código se repetir na estação, o ORDER BY
  // deixa o sensor ativo por último, e ele prevalece no Map.
  for (const row of resultado.rows) {
    mapa.set(row.codigo, row);
  }

  return mapa;
};
