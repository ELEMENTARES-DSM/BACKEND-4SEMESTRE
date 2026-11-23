import { randomUUID } from "node:crypto";
import { pool } from "../../config/db";

// Os testes de integração exigem PostgreSQL ativo configurado via DATABASE_URL
const databaseUrl = process.env.DATABASE_URL;
const integration = describe;

integration("Task 42.02 - Cadastro do Munícipe (PostgreSQL)", () => {
  const schema = `gestao_usuarios_task4202_${randomUUID().replaceAll("-", "")}`;

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
    await pool.query("DROP TABLE IF EXISTS usuarios CASCADE");
    await pool.query("DROP TABLE IF EXISTS papeis CASCADE");
  });

  it("1. Migration adiciona e remove a coluna aceite_privacidade_em com sucesso", async () => {
    // Sobe a estrutura inicial (papeis, usuarios e municipe)
    await executarMigrationUp("../../db/migrations/1789524760019_create-papeis-table.cjs");
    await executarMigrationUp("../../db/migrations/1789524760555_create-usuarios-table.cjs");
    await executarMigrationUp("../../db/migrations/1794570631515_cria-papel-municipe.cjs");

    // Aplica a migration da Task 42.02
    await executarMigrationUp("../../db/migrations/1794907000000_add-aceite-privacidade-usuarios.cjs");

    // Verifica que a coluna aceite_privacidade_em existe na tabela
    const colunas = await pool.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'usuarios' AND column_name = 'aceite_privacidade_em'
    `);
    expect(colunas.rows).toHaveLength(1);

    // Rollback
    await executarMigrationDown("../../db/migrations/1794907000000_add-aceite-privacidade-usuarios.cjs");

    const colunasAposDown = await pool.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'usuarios' AND column_name = 'aceite_privacidade_em'
    `);
    expect(colunasAposDown.rows).toHaveLength(0);
  });

  it("2. Persistência de munícipe: insere registro com aceite_privacidade_em e papel MUNICIPE", async () => {
    await executarMigrationUp("../../db/migrations/1789524760019_create-papeis-table.cjs");
    await executarMigrationUp("../../db/migrations/1789524760555_create-usuarios-table.cjs");
    await executarMigrationUp("../../db/migrations/1794570631515_cria-papel-municipe.cjs");
    await executarMigrationUp("../../db/migrations/1794907000000_add-aceite-privacidade-usuarios.cjs");

    // Consulta papel MUNICIPE
    const papelRes = await pool.query<{ id: string }>(
      "SELECT id FROM papeis WHERE nome = 'MUNICIPE'"
    );
    expect(papelRes.rows).toHaveLength(1);
    const municipeId = papelRes.rows[0].id;

    // Insere munícipe com aceite de privacidade
    const insertRes = await pool.query<{ id: string; email: string; aceite_privacidade_em: Date }>(`
      INSERT INTO usuarios (nome, email, senha_hash, papel_id, municipio, aceite_privacidade_em)
      VALUES ('Ana Munícipe', 'ana.municipe@exemplo.com', 'hash_bcrypt', $1, 'São José dos Campos', NOW())
      RETURNING id, email, aceite_privacidade_em
    `, [municipeId]);

    expect(insertRes.rows).toHaveLength(1);
    expect(insertRes.rows[0].email).toBe("ana.municipe@exemplo.com");
    expect(insertRes.rows[0].aceite_privacidade_em).toBeDefined();

    // Cenário 2 da US-42: violação de unicidade de e-mail impede segundo insert
    await expect(
      pool.query(`
        INSERT INTO usuarios (nome, email, senha_hash, papel_id, municipio, aceite_privacidade_em)
        VALUES ('Outra Ana', 'ana.municipe@exemplo.com', 'hash_bcrypt2', $1, NULL, NOW())
      `, [municipeId])
    ).rejects.toThrow();
  });
});
