import { Pool, PoolClient, QueryResult } from "pg";
import { pool } from "../config/db";
import { SensorEventoRow } from "../dto/evento-telemetria.dto";

export type DbQueryable = Pick<Pool | PoolClient, "query">;

/**
 * Busca os sensores da estação correspondentes aos códigos informados no evento
 * em uma única consulta SQL, sem cache em memória, trazendo também o município
 * herdado da estação (sensores -> estacoes.municipio) e o tipo (grandeza), usado
 * para conferir a faixa física (US-19).
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
       s.tipo,
       e.municipio
     FROM sensores s
     JOIN estacoes e ON e.id = s.estacao_id
     WHERE s.estacao_id = $1
       AND s.codigo = ANY($2::varchar[])`,
    [estacaoUuid, codigosUnicos],
  );

  for (const row of resultado.rows) {
    mapa.set(row.codigo, row);
  }

  return mapa;
};
