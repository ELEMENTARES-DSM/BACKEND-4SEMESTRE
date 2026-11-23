import { Pool } from "pg";

// MAC de teste derivado do UUID da estação: 12 últimos hex do UUID, em minúsculas.
// Único por estação e no formato que o tópico MQTT usa (pulso/estacoes/<mac>/telemetria).
export const macDaEstacao = (uuid: string): string =>
  uuid.replace(/-/g, "").slice(-12).toLowerCase();

// Tabela estacoes mínima para os testes de integração. A migration real é do
// gestao-estacoes; a ingestão só lê o status e escreve ultimo_ping e nivel_bateria.
export async function criarTabelaEstacoes(pool: Pick<Pool, "query">): Promise<void> {
  await pool.query(`
    CREATE TABLE estacoes (
      id UUID PRIMARY KEY,
      mac_address CHAR(12) UNIQUE,
      status VARCHAR(20) NOT NULL DEFAULT 'Ativa',
      criado_em TIMESTAMPTZ NOT NULL DEFAULT '2026-01-01T00:00:00Z',
      nivel_bateria INT,
      ultimo_ping TIMESTAMPTZ
    )
  `);
}

export async function cadastrarEstacao(
  pool: Pick<Pool, "query">,
  id: string,
  status: "Ativa" | "Inativa" | "Com Falha" = "Ativa",
  criadoEm?: Date,
): Promise<void> {
  await pool.query(
    `INSERT INTO estacoes (id, mac_address, status, criado_em) VALUES ($1, $2, $3, COALESCE($4, '2026-01-01T00:00:00Z'::timestamptz))
     ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, criado_em = EXCLUDED.criado_em`,
    [id, macDaEstacao(id), status, criadoEm ?? null],
  );
}
