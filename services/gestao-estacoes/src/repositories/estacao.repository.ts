import { pool } from "../config/db";
import { Estacao } from "../models/estacao.model";

export const findById = async (id: string): Promise<Estacao | null> => {
  const result = await pool.query<Estacao>(
    `SELECT id, codigo, nome, municipio FROM estacoes WHERE id = $1`,
    [id]
  );

  return result.rows[0] ?? null;
};