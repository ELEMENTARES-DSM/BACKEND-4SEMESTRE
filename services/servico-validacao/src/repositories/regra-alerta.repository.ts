import { QueryResult } from "pg";
import { pool } from "../config/db";
import { RegraAtivaRow } from "../dto/alarme.dto";
import { DbQueryable } from "./sensor.repository";

/**
 * US-22: regras ativas dos sensores do evento, numa única consulta e sem cache.
 * regras_alerta é do alertas-notificacoes: aqui só leitura.
 */
export const buscarRegrasAtivasPorSensores = async (
  sensorIds: string[],
  db: DbQueryable = pool,
): Promise<RegraAtivaRow[]> => {
  const unicos = Array.from(new Set(sensorIds));
  if (unicos.length === 0) {
    return [];
  }

  const resultado: QueryResult<RegraAtivaRow> = await db.query<RegraAtivaRow>(
    `SELECT id, sensor_id, operador, valor_limite, severidade
     FROM regras_alerta
     WHERE sensor_id = ANY($1::uuid[])
       AND esta_ativo
     ORDER BY criado_em, id`,
    [unicos],
  );

  return resultado.rows;
};
