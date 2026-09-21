import { pool } from "../config/db";
import { Sensor, StatusSensor } from "../models/sensor.model";
import { CreateSensorDTO } from "../dto/create-sensor.dto";

export const create = async (
  estacaoId: string,
  data: CreateSensorDTO
): Promise<Sensor> => {
  const result = await pool.query<Sensor>(
    `INSERT INTO sensores (estacao_id, codigo, nome, grandeza, unidade)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [estacaoId, data.codigo, data.nome, data.grandeza, data.unidade]
  );

  return result.rows[0];
};

export const findByEstacaoId = async (
  estacaoId: string
): Promise<Sensor[]> => {
  const result = await pool.query<Sensor>(
    `SELECT * FROM sensores WHERE estacao_id = $1 ORDER BY nome`,
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

export const updateStatus = async (
  id: string,
  status: StatusSensor
): Promise<Sensor | null> => {
  const result = await pool.query<Sensor>(
    `UPDATE sensores
     SET status = $1, atualizado_em = CURRENT_TIMESTAMP
     WHERE id = $2
     RETURNING *`,
    [status, id]
  );

  return result.rows[0] ?? null;
};