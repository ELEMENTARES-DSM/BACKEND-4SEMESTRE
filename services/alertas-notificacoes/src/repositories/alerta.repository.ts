import { pool } from "../config/db";
import type { Alerta } from "../models/alerta.model";

interface CreateParams {
  sensor_id: string;
  nome: string;
  operador: ">" | ">=" | "<" | "<=" | "=";
  valor_limite: number;
  severidade: "ATENCAO" | "ALERTA" | "CRITICO";
  fator: number;
  ganho: number;
  esta_ativo?: boolean;
}

interface UpdateParams {
  nome?: string;
  operador?: ">" | ">=" | "<" | "<=" | "=";
  valor_limite?: number;
  severidade?: "ATENCAO" | "ALERTA" | "CRITICO";
  fator?: number;
  ganho?: number;
  esta_ativo?: boolean;
}

export const create = async (params: CreateParams): Promise<Alerta> => {
  const result = await pool.query<Alerta>(
    `INSERT INTO regras_alerta (
        sensor_id,
        nome,
        operador,
        valor_limite,
        severidade,
        fator,
        ganho,
        esta_ativo
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      params.sensor_id,
      params.nome,
      params.operador,
      params.valor_limite,
      params.severidade,
      params.fator,
      params.ganho,
      params.esta_ativo ?? true,
    ],
  );

  return result.rows[0];
};

export const findAll = async (): Promise<Alerta[]> => {
  const result = await pool.query<Alerta>(
    `SELECT *
     FROM regras_alerta
     ORDER BY id DESC`,
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
     ORDER BY id DESC`,
    [sensorId],
  );

  return result.rows;
};

export const findAtivas = async (): Promise<Alerta[]> => {
  const result = await pool.query<Alerta>(
    `SELECT *
     FROM regras_alerta
     WHERE esta_ativo = TRUE
     ORDER BY id DESC`,
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
  esta_ativo: boolean,
): Promise<Alerta | null> => {
  const result = await pool.query<Alerta>(
    `UPDATE regras_alerta
     SET esta_ativo = $1
     WHERE id = $2
     RETURNING *`,
    [esta_ativo, id],
  );

  return result.rows[0] ?? null;
};
