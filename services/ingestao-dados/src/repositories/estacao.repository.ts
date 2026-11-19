import { pool } from "../config/db";

export interface AtualizarSinalEstacaoInput {
  estacaoId: string;
  ultimoPing: string;
  nivelBateria?: number;
}

/**
 * Status do cadastro da estação ("Ativa", "Inativa" ou "Com Falha"), ou null
 * quando o UUID não existe. A ingestão só lê a tabela estacoes (US-12).
 */
export async function buscarEstacaoParaValidacao(
  estacaoId: string,
): Promise<{ status: string; criado_em: Date } | null> {
  const res = await pool.query<{ status: string; criado_em: Date }>(
    "SELECT status, criado_em FROM estacoes WHERE id = $1",
    [estacaoId],
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
