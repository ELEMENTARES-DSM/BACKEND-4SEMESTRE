import { Pool } from "pg";

// Schema isolado com estacoes e sensores mínimos (as migrations reais são do
// gestao-estacoes) e a migration real de medidas do servico-validacao.
export async function prepararSchemaValidacao(pool: Pool, schema: string): Promise<void> {
  // O módulo db é carregado antes dos hooks: configurar o pool explicitamente.
  pool.options.connectionString = process.env.VALIDACAO_TEST_DATABASE_URL;
  pool.options.options = `-c search_path=${schema}`;
  await pool.query(`CREATE SCHEMA ${schema}`);

  await pool.query(`
    CREATE TABLE estacoes (
      id UUID PRIMARY KEY,
      municipio VARCHAR(100) NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE sensores (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      estacao_id UUID NOT NULL REFERENCES estacoes(id),
      tipo VARCHAR(50) NOT NULL DEFAULT 'Temperatura',
      codigo VARCHAR(30),
      fator NUMERIC(12,6) NOT NULL DEFAULT 1.0,
      ganho NUMERIC(12,6) NOT NULL DEFAULT 0.0,
      status VARCHAR(20) NOT NULL DEFAULT 'Ativo'
    )
  `);

  // Migration CommonJS gerada pelo node-pg-migrate.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const migration = require("../../../db/migrations/1792502100000_create-medidas-table.cjs");
  const comandos: string[] = [];
  migration.up({ sql: (sql: string) => comandos.push(sql) });
  for (const sql of comandos) await pool.query(sql);
}

export async function cadastrarEstacao(
  pool: Pick<Pool, "query">,
  id: string,
  municipio = "São José dos Campos",
): Promise<void> {
  await pool.query("INSERT INTO estacoes (id, municipio) VALUES ($1, $2)", [id, municipio]);
}

export interface NovoSensor {
  estacaoId: string;
  codigo: string;
  tipo?: string;
  status?: "Ativo" | "Inativo";
  fator?: string;
  ganho?: string;
}

export async function cadastrarSensor(
  pool: Pick<Pool, "query">,
  sensor: NovoSensor,
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO sensores (estacao_id, codigo, tipo, status, fator, ganho)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      sensor.estacaoId,
      sensor.codigo,
      sensor.tipo ?? "Temperatura",
      sensor.status ?? "Ativo",
      sensor.fator ?? "1.0",
      sensor.ganho ?? "0.0",
    ],
  );
  return rows[0].id;
}
