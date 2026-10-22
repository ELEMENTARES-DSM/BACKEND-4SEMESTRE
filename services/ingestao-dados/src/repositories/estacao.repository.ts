import { PoolClient } from "pg";
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
export async function buscarStatusEstacao(
  estacaoId: string,
): Promise<string | null> {
  const res = await pool.query<{ status: string }>(
    "SELECT status FROM estacoes WHERE id = $1",
    [estacaoId],
  );
  return res.rows[0]?.status ?? null;
}

export async function atualizarSinalEstacao(
  client: PoolClient,
  dados: AtualizarSinalEstacaoInput,
): Promise<boolean> {
  if (dados.nivelBateria !== undefined) {
    const res = await client.query(
      `
      UPDATE estacoes
      SET
        ultimo_ping = $1,
        nivel_bateria = $2
      WHERE id = $3
      `,
      [dados.ultimoPing, dados.nivelBateria, dados.estacaoId],
    );
    return (res.rowCount ?? 0) > 0;
  } else {
    const res = await client.query(
      `
      UPDATE estacoes
      SET
        ultimo_ping = $1
      WHERE id = $2
      `,
      [dados.ultimoPing, dados.estacaoId],
    );
    return (res.rowCount ?? 0) > 0;
  }
}
