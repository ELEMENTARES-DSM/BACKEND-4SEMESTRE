import { pool } from "../config/db";
import { Sensor, StatusSensor, TipoSensor } from "../models/sensor.model";

interface DadosSensor {
  tipo: TipoSensor;
  unidadeMedida: string;
  fator: number;
  ganho: number;
}

export const create = async (
  estacaoId: string,
  dados: DadosSensor
): Promise<Sensor> => {
  const result = await pool.query<Sensor>(
    `INSERT INTO sensores (estacao_id, tipo, unidade_medida, fator, ganho)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [estacaoId, dados.tipo, dados.unidadeMedida, dados.fator, dados.ganho]
  );

  return result.rows[0];
};

export const findByEstacaoId = async (
  estacaoId: string
): Promise<Sensor[]> => {
  const result = await pool.query<Sensor>(
    `SELECT * FROM sensores WHERE estacao_id = $1 ORDER BY tipo`,
    [estacaoId]
  );

  return result.rows;
};

export const findById = async (id: string): Promise<Sensor | null> => {
  const result = await pool.query<Sensor>(
    `SELECT * FROM sensores WHERE id = $1`,
    [id]
  );

  return result.rows[0] ?? null;
};

export const findByEstacaoIdETipo = async (
  estacaoId: string,
  tipo: TipoSensor,
  ignorarSensorId?: string
): Promise<Sensor | null> => {
  const result = await pool.query<Sensor>(
    `SELECT * FROM sensores
     WHERE estacao_id = $1 AND tipo = $2 AND id IS DISTINCT FROM $3`,
    [estacaoId, tipo, ignorarSensorId ?? null]
  );

  return result.rows[0] ?? null;
};

export const update = async (
  id: string,
  dados: DadosSensor
): Promise<Sensor | null> => {
  const result = await pool.query<Sensor>(
    `UPDATE sensores
     SET tipo = $1, unidade_medida = $2, fator = $3, ganho = $4
     WHERE id = $5
     RETURNING *`,
    [dados.tipo, dados.unidadeMedida, dados.fator, dados.ganho, id]
  );

  return result.rows[0] ?? null;
};

export const updateStatus = async (
  id: string,
  status: StatusSensor
): Promise<Sensor | null> => {
  const result = await pool.query<Sensor>(
    `UPDATE sensores
     SET status = $1
     WHERE id = $2
     RETURNING *`,
    [status, id]
  );

  return result.rows[0] ?? null;
};
