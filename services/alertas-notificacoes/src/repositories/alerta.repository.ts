import { pool } from "../config/db";
import type { Alerta } from "../models/alertas";

interface CreateParams {
  sensor_id: string;
  nome: string;
  operador: ">" | ">=" | "<" | "<=" | "=";
  limiar: number;
  severidade: "ATENCAO" | "ALERTA" | "CRITICO";
}

interface UpdateParams {
  nome?: string;
  operador?: ">" | ">=" | "<" | "<=" | "=";
  limiar?: number;
  severidade?: "ATENCAO" | "ALERTA" | "CRITICO";
  status?: "Ativa" | "Inativa";
}

export const create = async (params: CreateParams): Promise<Alerta> => {
  const result = await pool.query<Alerta>(
    `INSERT INTO regras_alerta (
        sensor_id,
        nome,
        operador,
        limiar,
        severidade
     )
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      params.sensor_id,
      params.nome,
      params.operador,
      params.limiar,
      params.severidade,
    ],
  );

  return result.rows[0];
};

export const findAll = async (): Promise<Alerta[]> => {
  const result = await pool.query<Alerta>(
    `SELECT *
     FROM regras_alerta
     ORDER BY criado_em DESC`,
  );

  return result.rows;
};

export const findById = async (id: string): Promise<Alerta | null> => {
  const result = await pool.query<Alerta>(
    `SELECT *
     FROM regras_alerta
     WHERE id = $1`,
    [id],
  );

  return result.rows[0] ?? null;
};

export const findBySensorId = async (sensorId: string): Promise<Alerta[]> => {
  const result = await pool.query<Alerta>(
    `SELECT *
     FROM regras_alerta
     WHERE sensor_id = $1
     ORDER BY criado_em DESC`,
    [sensorId],
  );

  return result.rows;
};

export const findAtivas = async (): Promise<Alerta[]> => {
  const result = await pool.query<Alerta>(
    `SELECT *
     FROM regras_alerta
     WHERE status = 'Ativa'
     ORDER BY criado_em DESC`,
  );

  return result.rows;
};

export const update = async (
  id: string,
  params: UpdateParams,
): Promise<Alerta | null> => {
  const fields: string[] = [];
  const values: unknown[] = [];
  let index = 1;

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      fields.push(`${key} = $${index}`);
      values.push(value);
      index++;
    }
  }

  if (fields.length === 0) {
    return findById(id);
  }

  values.push(id);

  const result = await pool.query<Alerta>(
    `UPDATE regras_alerta
     SET ${fields.join(", ")}
     WHERE id = $${index}
     RETURNING *`,
    values,
  );

  return result.rows[0] ?? null;
};

export const updateStatus = async (
  id: string,
  status: "Ativa" | "Inativa",
): Promise<Alerta | null> => {
  const result = await pool.query<Alerta>(
    `UPDATE regras_alerta
     SET status = $1
     WHERE id = $2
     RETURNING *`,
    [status, id],
  );

  return result.rows[0] ?? null;
};
