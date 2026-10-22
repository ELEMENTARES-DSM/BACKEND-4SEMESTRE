import { Pool } from "pg";

// Tabela estacoes mínima para os testes de integração. A migration real é do
// gestao-estacoes; a ingestão só lê o status e escreve ultimo_ping e nivel_bateria.
export async function criarTabelaEstacoes(pool: Pick<Pool, "query">): Promise<void> {
  await pool.query(`
    CREATE TABLE estacoes (
      id UUID PRIMARY KEY,
      status VARCHAR(20) NOT NULL DEFAULT 'Ativa',
      nivel_bateria INT,
      ultimo_ping TIMESTAMPTZ
    )
  `);
}

export async function cadastrarEstacao(
  pool: Pick<Pool, "query">,
  id: string,
  status: "Ativa" | "Inativa" | "Com Falha" = "Ativa",
): Promise<void> {
  await pool.query(
    `INSERT INTO estacoes (id, status) VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status`,
    [id, status],
  );
}
