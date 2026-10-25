import { pool } from "../config/db";
import { GestorAtivo } from "../models/notificacao.model";
import { DbQueryable } from "./notificacao.repository";

/**
 * US-23: gestores públicos ativos do município, lidos no momento do envio.
 * usuarios e papeis são do gestao-usuarios: aqui só leitura. Administradores e
 * pesquisadores não recebem aviso.
 */
export const findGestoresAtivosDoMunicipio = async (
  municipio: string,
  db: DbQueryable = pool
): Promise<GestorAtivo[]> => {
  const result = await db.query<GestorAtivo>(
    `SELECT u.id, u.nome, u.email
     FROM usuarios u
     JOIN papeis p ON p.id = u.papel_id
     WHERE p.nome = 'GESTOR_PUBLICO'
       AND u.esta_ativo
       AND u.municipio = $1
     ORDER BY u.nome, u.id`,
    [municipio]
  );

  return result.rows;
};
