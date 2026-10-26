import { QueryResult } from "pg";
import { pool } from "../config/db";
import {
  AlarmeNormalizadoRow,
  AlarmeRow,
  NovoAlarmeInput,
} from "../dto/alarme.dto";
import { DbQueryable } from "./sensor.repository";

const COLUNAS_ALARME = `id, regra_id, medida_id, sensor_id, estacao_id, municipio, valor,
       operador, limite, severidade, situacao, lido_em, criado_em`;

/**
 * Grava um alarme aberto. Devolve null quando já existe alarme para a mesma
 * regra e medida (evento entregue de novo) ou um alarme aberto da mesma regra
 * (violação contínua): os dois casos são barrados pelos índices únicos.
 */
export const inserirAlarmeAberto = async (
  dados: NovoAlarmeInput,
  db: DbQueryable = pool,
): Promise<AlarmeRow | null> => {
  const resultado: QueryResult<AlarmeRow> = await db.query<AlarmeRow>(
    `INSERT INTO alarmes (
       regra_id, medida_id, sensor_id, estacao_id, municipio,
       valor, operador, limite, severidade, lido_em, criado_em
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT DO NOTHING
     RETURNING ${COLUNAS_ALARME}`,
    [
      dados.regra_id,
      dados.medida_id,
      dados.sensor_id,
      dados.estacao_id,
      dados.municipio,
      dados.valor,
      dados.operador,
      dados.limite,
      dados.severidade,
      dados.lido_em.toISOString(),
      dados.criado_em.toISOString(),
    ],
  );

  return resultado.rows[0] ?? null;
};

/**
 * Passa para normalizado o alarme aberto da regra, se a medida que voltou ao
 * normal não for mais antiga que a que abriu o alarme (eventos podem chegar fora
 * de ordem).
 */
export const normalizarAlarmeAberto = async (
  regraId: string,
  lidoEm: Date,
  agora: Date,
  db: DbQueryable = pool,
): Promise<AlarmeNormalizadoRow | null> => {
  const resultado: QueryResult<AlarmeNormalizadoRow> = await db.query<AlarmeNormalizadoRow>(
    `UPDATE alarmes
     SET situacao = 'normalizado', normalizado_em = $3
     WHERE regra_id = $1 AND situacao = 'aberto' AND lido_em <= $2
     RETURNING id, regra_id`,
    [regraId, lidoEm.toISOString(), agora.toISOString()],
  );

  return resultado.rows[0] ?? null;
};

/**
 * Normaliza os alarmes abertos dos sensores cuja regra foi inativada (ou não
 * existe mais): sem a regra, o valor nunca voltaria a ser comparado com ela.
 */
export const normalizarAlarmesDeRegrasInativas = async (
  sensorIds: string[],
  agora: Date,
  db: DbQueryable = pool,
): Promise<AlarmeNormalizadoRow[]> => {
  if (sensorIds.length === 0) {
    return [];
  }

  const resultado: QueryResult<AlarmeNormalizadoRow> = await db.query<AlarmeNormalizadoRow>(
    `UPDATE alarmes a
     SET situacao = 'normalizado', normalizado_em = $2
     WHERE a.situacao = 'aberto'
       AND a.sensor_id = ANY($1::uuid[])
       AND NOT EXISTS (
         SELECT 1 FROM regras_alerta r WHERE r.id = a.regra_id AND r.esta_ativo
       )
     RETURNING a.id, a.regra_id`,
    [sensorIds, agora.toISOString()],
  );

  return resultado.rows;
};

/** US-22: marca como publicados os alarmes que o RabbitMQ confirmou. */
export const marcarAlarmesPublicados = async (
  ids: string[],
  publicadoEm: Date,
  db: DbQueryable = pool,
): Promise<void> => {
  if (ids.length === 0) {
    return;
  }

  await db.query(
    `UPDATE alarmes
     SET publicado_em = $2
     WHERE id = ANY($1::uuid[]) AND publicado_em IS NULL`,
    [ids, publicadoEm.toISOString()],
  );
};

/** Alarmes ainda sem confirmação do RabbitMQ, mais antigos primeiro. */
export const buscarAlarmesNaoPublicados = async (
  limite: number,
  db: DbQueryable = pool,
): Promise<AlarmeRow[]> => {
  const resultado: QueryResult<AlarmeRow> = await db.query<AlarmeRow>(
    `SELECT ${COLUNAS_ALARME}
     FROM alarmes
     WHERE publicado_em IS NULL
     ORDER BY criado_em, id
     LIMIT $1`,
    [limite],
  );

  return resultado.rows;
};
