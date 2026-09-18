import { pool } from "../config/db";
import { Estacao } from "../models/estacao.model";

interface CreateParams {
  codigo: string;
  nome: string;
  municipio: string;
  latitude: number;
  longitude: number;
  status?: string;
}

interface UpdateParams {
  nome?: string;
  latitude?: number;
  longitude?: number;
  status?: string;
  nivel_bateria?: number;
  ultimo_ping?: Date;
}

export const create = async (params: CreateParams): Promise<Estacao> => {
  const result = await pool.query<Estacao>(
    `INSERT INTO estacao (codigo, nome, municipio, latitude, longitude, status)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      params.codigo,
      params.nome, 
      params.municipio, 
      params.latitude, 
      params.longitude, 
      params.status ?? 'Ativa'
    ]
  );

  return result.rows[0];
};

export const findAll = async (): Promise<Estacao[]> => {
  const result = await pool.query<Estacao>(
    `SELECT * FROM estacao
     ORDER BY criado_em DESC`,
  );

  return result.rows;
};

export const findByMunicipio = async (municipio: string): Promise<Estacao[]> => {
  const result = await pool.query<Estacao>(
    `SELECT * FROM estacao
     WHERE municipio = $1
     ORDER BY criado_em DESC`,
    [municipio]
  );

  return result.rows;
};

export const findById = async (id: string): Promise<Estacao | null> => {
  const result = await pool.query<Estacao>(
    `SELECT * FROM estacao WHERE id = $1`,
    [id]
  );

  return result.rows[0] ?? null;
};

export const findByCodigo = async (codigo: string): Promise<Estacao | null> => {
  const result = await pool.query<Estacao>(
    `SELECT * FROM estacoes WHERE codigo = $1`,
    [codigo]
  );
  return result.rows[0] ?? null;
};

export const update = async (
  id: string,
  params: UpdateParams
): Promise<Estacao | null> => {
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

  fields.push(`atualizado_em = CURRENT_TIMESTAMP`);
  values.push(id);

  const result = await pool.query<Estacao>(
    `UPDATE estacao SET ${fields.join(", ")} WHERE id = $${index} RETURNING *`,
    values
  );

  return result.rows[0] ?? null;
};

// Soft delete — segue o padrão do modelo (status = FALSE, sem apagar a linha)
export const softDelete = async (id: string): Promise<Estacao | null> => {
  const result = await pool.query<Estacao>(
    `UPDATE estacao SET status =  'Inativa' WHERE id = $1 RETURNING *`,
    [id]
  );

  return result.rows[0] ?? null;
};