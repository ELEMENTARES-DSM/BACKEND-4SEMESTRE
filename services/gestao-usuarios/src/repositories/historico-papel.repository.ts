import { pool } from "../config/db";
import { HistoricoTrocaPapel } from "../models/historico-papel.model";

interface RegistrarParams {
  usuario_id: string;
  papel_anterior_id: string;
  papel_novo_id: string;
  alterado_por: string;
}

export const registrar = async (params: RegistrarParams): Promise<HistoricoTrocaPapel> => {
  const result = await pool.query<HistoricoTrocaPapel>(
    `INSERT INTO historico_trocas_papel (usuario_id, papel_anterior_id, papel_novo_id, alterado_por)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [params.usuario_id, params.papel_anterior_id, params.papel_novo_id, params.alterado_por]
  );

  return result.rows[0];
};

export const findByUsuarioId = async (usuarioId: string): Promise<HistoricoTrocaPapel[]> => {
  const result = await pool.query<HistoricoTrocaPapel>(
    `SELECT * FROM historico_trocas_papel
     WHERE usuario_id = $1
     ORDER BY criado_em DESC`,
    [usuarioId]
  );

  return result.rows;
};
