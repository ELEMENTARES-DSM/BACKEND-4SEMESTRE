import { pool } from "../config/db";
import {
  Estacao,
  EstacaoComStatusOperacional,
} from "../models/estacao.model";

export const findById = async (id: string): Promise<Estacao | null> => {
  const result = await pool.query<Estacao>(
    `SELECT id, codigo, nome, municipio FROM estacoes WHERE id = $1`,
    [id]
  );

  return result.rows[0] ?? null;
};

export const findStatusByMunicipio = async (
  municipio: string
): Promise<EstacaoComStatusOperacional[]> => {
  const result = await pool.query<EstacaoComStatusOperacional>(
    `SELECT id, codigo, nome, ultimo_ping,
            CASE
              WHEN status = 'Inativa' THEN 'Inativa'
              WHEN status = 'Ativa'
                   AND (NOW() - ultimo_ping) <= INTERVAL '45 minutes' THEN 'Ativa'
              ELSE 'Com Falha'
            END AS status_operacional
     FROM estacoes
     WHERE municipio = $1
     ORDER BY codigo`,
    [municipio]
  );

  return result.rows;
};
