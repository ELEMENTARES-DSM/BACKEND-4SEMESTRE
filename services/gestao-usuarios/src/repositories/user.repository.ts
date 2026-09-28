import { pool } from "../config/db";
import { Usuario, UsuarioComPapel } from "../models/user.model";

interface CreateParams {
  nome: string;
  email: string;
  senhaHash: string;
  papel_id: string;
  municipio?: string;
}

interface UpdateParams {
  nome?: string;
  email?: string;
  municipio?: string;
  papel_id?: string;
  esta_ativo?: boolean;
}

export const create = async (params: CreateParams): Promise<Usuario> => {
  const result = await pool.query<Usuario>(
    `INSERT INTO usuarios (nome, email, senha_hash, papel_id, municipio)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [params.nome, params.email, params.senhaHash, params.papel_id, params.municipio ?? null]
  );

  return result.rows[0];
};

export const findAll = async (): Promise<UsuarioComPapel[]> => {
  const result = await pool.query<UsuarioComPapel>(
    `SELECT
        u.id, u.nome, u.email, u.papel_id, u.municipio,
        u.esta_ativo, u.criado_em, u.atualizado_em,
        p.nome AS papel_nome
     FROM usuarios u
     JOIN papeis p ON p.id = u.papel_id
     ORDER BY u.criado_em DESC`
  );

  return result.rows;
};

export const findById = async (id: string): Promise<Usuario | null> => {
  const result = await pool.query<Usuario>(
    `SELECT
        u.id, u.nome, u.email, u.papel_id, u.municipio,
        u.esta_ativo, u.criado_em, u.atualizado_em,
        p.nome AS papel_nome
     FROM usuarios u
     JOIN papeis p ON p.id = u.papel_id
     WHERE u.id = $1`,
    [id]
  );

  return result.rows[0] ?? null;
};

export const findByEmail = async (email: string): Promise<Usuario | null> => {
  const result = await pool.query<Usuario>(
    `SELECT
        u.id, u.nome, u.email, u.papel_id, u.municipio,
        u.esta_ativo, u.criado_em, u.atualizado_em,
        p.nome AS papel_nome
     FROM usuarios u
     JOIN papeis p ON p.id = u.papel_id
     WHERE u.email = $1`,
    [email]
  );

  return result.rows[0] ?? null;
};

export const update = async (
  id: string,
  params: UpdateParams
): Promise<Usuario | null> => {
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

  const result = await pool.query<Usuario>(
    `UPDATE usuarios SET ${fields.join(", ")} WHERE id = $${index} RETURNING *`,
    values
  );

  return result.rows[0] ?? null;
};

// Soft delete — segue o padrão do modelo (esta_ativo = FALSE, sem apagar a linha)
export const softDelete = async (id: string): Promise<Usuario | null> => {
  const result = await pool.query<Usuario>(
    `UPDATE usuarios SET esta_ativo = FALSE, atualizado_em = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING *`,
    [id]
  );

  return result.rows[0] ?? null;
};

export const hardDelete = async (id: string): Promise<Usuario | null> => {
  const result = await pool.query<Usuario>(
    `DELETE FROM usuarios WHERE id = $1 RETURNING *`,
    [id]
  )

  return result.rows[0] ?? null
}
