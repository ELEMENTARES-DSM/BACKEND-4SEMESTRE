import { randomUUID } from "node:crypto";
import { pool } from "../../config/db";

// Os testes de integração reais exigem PostgreSQL ativo configurado via DATABASE_URL
// (mesma variável usada pelo pool em src/config/db.ts e referenciada no .env.example do serviço).
// Caso DATABASE_URL não esteja definida ou o banco não esteja acessível, os testes
// de integração são pulados via describe.skip para garantir compatibilidade no CI.
const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("Task 42.01 - Substituição de PESQUISADOR por MUNICIPE (PostgreSQL)", () => {
  const schema = `gestao_usuarios_task42_${randomUUID().replaceAll("-", "")}`;

  // Executa os comandos up de uma migration via callback fake do node-pg-migrate
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

  // Executa os comandos down de uma migration via callback fake do node-pg-migrate
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

  it("1. Substituição in-place: PESQUISADOR existente é transformado em MUNICIPE preservando UUID e removendo PESQUISADOR", async () => {
    // Sobe a migration inicial de criação de tabelas (que insere ADMINISTRADOR, GESTOR_PUBLICO, PESQUISADOR)
    await executarMigrationUp("../../db/migrations/1789524760019_create-papeis-table.cjs");

    const pesquisadorAntes = await pool.query<{ id: string }>(
      "SELECT id FROM papeis WHERE nome = 'PESQUISADOR'"
    );
    expect(pesquisadorAntes.rows).toHaveLength(1);
    const pesquisadorIdOriginal = pesquisadorAntes.rows[0].id;

    // Aplica a migration da Task 42.01
    await executarMigrationUp("../../db/migrations/1794570631515_cria-papel-municipe.cjs");

    // Verifica que MUNICIPE foi criado com o mesmo UUID
    const municipeDepois = await pool.query<{ id: string; nome: string; descricao: string }>(
      "SELECT id, nome, descricao FROM papeis WHERE nome = 'MUNICIPE'"
    );
    expect(municipeDepois.rows).toHaveLength(1);
    expect(municipeDepois.rows[0].id).toBe(pesquisadorIdOriginal);
    expect(municipeDepois.rows[0].descricao).toBe(
      "Cidadao com conta propria para acompanhamento e alertas personalizados."
    );

    // Verifica que PESQUISADOR não existe mais
    const pesquisadorDepois = await pool.query(
      "SELECT id FROM papeis WHERE nome = 'PESQUISADOR'"
    );
    expect(pesquisadorDepois.rows).toHaveLength(0);
  });

  it("2. Idempotência e Rollback: reexecução não falha e rollback restaura PESQUISADOR", async () => {
    await executarMigrationUp("../../db/migrations/1789524760019_create-papeis-table.cjs");
    // Primeira execução do up
    await executarMigrationUp("../../db/migrations/1794570631515_cria-papel-municipe.cjs");
    // Segunda execução do up (reexecução idempotente)
    await executarMigrationUp("../../db/migrations/1794570631515_cria-papel-municipe.cjs");

    const papeisDepois = await pool.query<{ nome: string }>(
      "SELECT nome FROM papeis ORDER BY nome"
    );
    expect(papeisDepois.rows.map((r) => r.nome)).toEqual([
      "ADMINISTRADOR",
      "GESTOR_PUBLICO",
      "MUNICIPE",
    ]);

    // Executa down (reversão)
    await executarMigrationDown("../../db/migrations/1794570631515_cria-papel-municipe.cjs");

    const papeisAposDown = await pool.query<{ nome: string }>(
      "SELECT nome FROM papeis ORDER BY nome"
    );
    expect(papeisAposDown.rows.map((r) => r.nome)).toEqual([
      "ADMINISTRADOR",
      "GESTOR_PUBLICO",
      "PESQUISADOR",
    ]);
  });

  it("3. Banco com usuários: usuário associado a PESQUISADOR passa a ter papel MUNICIPE sem violação de FK", async () => {
    // Sobe as migrations anteriores (papeis, usuarios e seed admin)
    await executarMigrationUp("../../db/migrations/1789524760019_create-papeis-table.cjs");
    await executarMigrationUp("../../db/migrations/1789524760555_create-usuarios-table.cjs");
    await executarMigrationUp("../../db/migrations/1789530000000_seed-admin-user.cjs");

    // Cadastra usuário com papel PESQUISADOR
    await pool.query(`
      INSERT INTO usuarios (nome, email, senha_hash, papel_id, municipio)
      SELECT 'Cidadão Antigo', 'pesquisador@fatec.sp.gov.br', 'hash_teste', p.id, NULL
      FROM papeis p WHERE p.nome = 'PESQUISADOR';
    `);

    const usuarioAntes = await pool.query<{ id: string; email: string; papel_nome: string }>(`
      SELECT u.id, u.email, p.nome as papel_nome
      FROM usuarios u
      JOIN papeis p ON p.id = u.papel_id
      WHERE u.email = 'pesquisador@fatec.sp.gov.br'
    `);
    expect(usuarioAntes.rows[0].papel_nome).toBe("PESQUISADOR");

    // Aplica a migration da Task 42.01
    await executarMigrationUp("../../db/migrations/1794570631515_cria-papel-municipe.cjs");

    // Verifica que o usuário agora está associado a MUNICIPE
    const usuarioDepois = await pool.query<{ id: string; email: string; papel_nome: string }>(`
      SELECT u.id, u.email, p.nome as papel_nome
      FROM usuarios u
      JOIN papeis p ON p.id = u.papel_id
      WHERE u.email = 'pesquisador@fatec.sp.gov.br'
    `);
    expect(usuarioDepois.rows[0].papel_nome).toBe("MUNICIPE");

    // Confere que todos os papéis são apenas ADMINISTRADOR, GESTOR_PUBLICO e MUNICIPE
    const todosPapeis = await pool.query<{ nome: string }>(
      "SELECT nome FROM papeis ORDER BY nome"
    );
    expect(todosPapeis.rows.map((r) => r.nome)).toEqual([
      "ADMINISTRADOR",
      "GESTOR_PUBLICO",
      "MUNICIPE",
    ]);
  });
});
