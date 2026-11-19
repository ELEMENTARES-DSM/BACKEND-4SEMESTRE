import { randomUUID } from "node:crypto";
import { pool } from "../../config/db";

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("Task 42.03 - Troca de Papel e Histórico (PostgreSQL)", () => {
  const schema = `gestao_usuarios_task4203_${randomUUID().replaceAll("-", "")}`;

  const executarMigrationUp = async (caminhoMigration: string) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const migration = require(caminhoMigration);
    const comandos: string[] = [];
    migration.up({
      sql: (sql: string) => comandos.push(sql),
    });
    for (const sql of comandos) {
      await pool.query(sql);
    }
  };

  const executarMigrationDown = async (caminhoMigration: string) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const migration = require(caminhoMigration);
    const comandos: string[] = [];
    migration.down({
      sql: (sql: string) => comandos.push(sql),
    });
    for (const sql of comandos) {
      await pool.query(sql);
    }
  };

  beforeAll(async () => {
    pool.options.connectionString = databaseUrl;
    pool.options.options = `-c search_path=${schema}`;
    await pool.query(`CREATE SCHEMA ${schema}`);
  });

  afterAll(async () => {
    try {
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await pool.end();
    }
  });

  beforeEach(async () => {
    await pool.query("DROP TABLE IF EXISTS historico_trocas_papel CASCADE");
    await pool.query("DROP TABLE IF EXISTS usuarios CASCADE");
    await pool.query("DROP TABLE IF EXISTS papeis CASCADE");
  });

  it("1. Migration cria e remove a tabela historico_trocas_papel com integridade", async () => {
    await executarMigrationUp("../../db/migrations/1789524760019_create-papeis-table.cjs");
    await executarMigrationUp("../../db/migrations/1789524760555_create-usuarios-table.cjs");
    await executarMigrationUp("../../db/migrations/1794570631515_cria-papel-municipe.cjs");
    await executarMigrationUp("../../db/migrations/1794912000000_create-historico-trocas-papel.cjs");

    const checkTable = await pool.query(
      `SELECT to_regclass('${schema}.historico_trocas_papel') AS tabela`
    );
    expect(checkTable.rows[0].tabela).not.toBeNull();

    await executarMigrationDown("../../db/migrations/1794912000000_create-historico-trocas-papel.cjs");
    const checkTableDropped = await pool.query(
      `SELECT to_regclass('${schema}.historico_trocas_papel') AS tabela`
    );
    expect(checkTableDropped.rows[0].tabela).toBeNull();
  });
});
