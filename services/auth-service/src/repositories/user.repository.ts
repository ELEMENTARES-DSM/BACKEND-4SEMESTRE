import { pool } from "../config/db";
import { UsuarioAuth } from "../models/auth.model";

export const findByEmailComPapel = async (
  email: string
): Promise<UsuarioAuth | null> => {
  const result = await pool.query<UsuarioAuth>(
    `SELECT
        u.id, u.nome, u.senha_hash, u.municipio, u.esta_ativo,
        p.nome AS papel
     FROM usuarios u
     JOIN papeis p ON p.id = u.papel_id
     WHERE u.email = $1`,
    [email]
  );

  return result.rows[0] ?? null;
};