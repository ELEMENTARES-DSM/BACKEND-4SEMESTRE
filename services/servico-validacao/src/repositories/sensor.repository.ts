import { Pool, PoolClient, QueryResult } from "pg";
import { pool } from "../config/db";
import { SensorEventoRow } from "../dto/evento-telemetria.dto";

export type DbQueryable = Pick<Pool | PoolClient, "query">;

/**
 * Busca os sensores da estação correspondentes aos códigos informados no evento
 * em uma única consulta SQL, sem cache em memória, trazendo também o município
 * herdado da estação (sensores -> estacoes.municipio), o tipo (grandeza), o
 * status da estação, que decide se a medida é avaliada pelas regras de alerta
 * (US-22), e a faixa física e a unidade da grandeza, lidas do catálogo
 * (tipos_sensor) por JOIN (US-19 e US-39): o Administrador muda a faixa sem
 * mudar o código, e a próxima leitura já usa o valor novo.
 *
 * A coluna offset_calibracao (OFFSET é palavra reservada do PostgreSQL) sai
 * com o alias "offset", entre aspas.
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
       s.fator_conversao,
       s.offset_calibracao AS "offset",
       s.status,
       s.tipo,
       t.faixa_min,
       t.faixa_max,
       t.unidade,
       e.municipio,
       e.status AS estacao_status
     FROM sensores s
     JOIN estacoes e ON e.id = s.estacao_id
     JOIN tipos_sensor t ON t.nome = s.tipo
     WHERE s.estacao_id = $1
       AND s.codigo = ANY($2::varchar[])`,
    [estacaoUuid, codigosUnicos],
  );

  for (const row of resultado.rows) {
    mapa.set(row.codigo, row);
  }

  return mapa;
};
