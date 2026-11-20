import path from "node:path";
import { Pool, PoolClient } from "pg";

/**
 * Roda o SQL das migrations num schema descartável do banco de teste. Assim o
 * teste não depende da ordem das migrations seguintes nem mexe nas tabelas que
 * a API em teste está usando.
 */
export interface Pgm {
  sql: (texto: string) => void;
}

export interface MigrationCjs {
  up: (pgm: Pgm) => void;
  down: (pgm: Pgm) => void;
}

const PASTA_MIGRATIONS = path.resolve(__dirname, "../../src/db/migrations");

export const carregarMigration = (arquivo: string): MigrationCjs =>
  require(path.join(PASTA_MIGRATIONS, arquivo)) as MigrationCjs;

export const executar = async (
  client: PoolClient,
  passo: (pgm: Pgm) => void,
): Promise<void> => {
  const comandos: string[] = [];
  passo({ sql: (texto) => comandos.push(texto) });
  for (const comando of comandos) await client.query(comando);
};

export const abrirSchema = async (pool: Pool, schema: string): Promise<PoolClient> => {
  const client = await pool.connect();
  await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(`SET search_path TO ${schema}, public`);
  return client;
};

export const fecharSchema = async (
  pool: Pool,
  client: PoolClient,
  schema: string,
): Promise<void> => {
  try {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  } finally {
    client.release();
    await pool.end();
  }
};
