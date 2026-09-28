import { pool } from "../config/db";
import { Papel } from "../models/papel.model";

export const findAll = async (): Promise<Papel[]> => {
  const result = await pool.query<Papel>(
    `SELECT * FROM papeis ORDER BY nome`
  );

  return result.rows;
};

export const findById = async (id: string): Promise<Papel | null> => {
  const result = await pool.query<Papel>(
    `SELECT * FROM papeis WHERE id = $1`,
    [id]
  );

  return result.rows[0] ?? null;
};