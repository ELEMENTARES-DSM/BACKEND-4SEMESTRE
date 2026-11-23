import { pool } from "../config/db";

export interface AtualizarSinalEstacaoInput {
  estacaoId: string;
  ultimoPing: string;
  nivelBateria?: number;
}

/**
 * Cadastro da estação dono do MAC do tópico: UUID interno, status ("Ativa",
 * "Inativa" ou "Com Falha") e data de cadastro, ou null se o MAC não existe.
 * A ingestão só lê a tabela estacoes (US-12).
 */
export async function buscarEstacaoParaValidacao(
  macAddress: string,
): Promise<{ id: string; status: string; criado_em: Date } | null> {
  const res = await pool.query<{ id: string; status: string; criado_em: Date }>(
    "SELECT id, status, criado_em FROM estacoes WHERE mac_address = $1",
    [macAddress],
  );
  return res.rows[0] ?? null;
}

/**
 * Último sinal e bateria (US-14). Sem nivel_bateria na leitura, a bateria
 * guardada fica como está.
 */
export async function atualizarSinalEstacao(dados: AtualizarSinalEstacaoInput): Promise<boolean> {
  const res = await pool.query(
    `UPDATE estacoes
     SET ultimo_ping = $1, nivel_bateria = COALESCE($2, nivel_bateria)
     WHERE id = $3`,
    [dados.ultimoPing, dados.nivelBateria ?? null, dados.estacaoId],
  );
  return (res.rowCount ?? 0) > 0;
}
