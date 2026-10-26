import { Pool } from "pg";

// Schema isolado com papeis e usuarios mínimos (as migrations reais são do
// gestao-usuarios) e a migration real de notificacoes do alertas-notificacoes.
export async function prepararSchemaNotificacoes(pool: Pool, schema: string): Promise<void> {
  // O módulo db é carregado antes dos hooks: configurar o pool explicitamente.
  pool.options.connectionString = process.env.ALERTAS_TEST_DATABASE_URL;
  pool.options.options = `-c search_path=${schema}`;
  await pool.query(`CREATE SCHEMA ${schema}`);

  await pool.query(`
    CREATE TABLE papeis (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      nome VARCHAR(50) NOT NULL UNIQUE
    )
  `);
  await pool.query(`
    INSERT INTO papeis (nome) VALUES ('ADMINISTRADOR'), ('GESTOR_PUBLICO'), ('PESQUISADOR')
  `);
  await pool.query(`
    CREATE TABLE usuarios (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      nome VARCHAR(120) NOT NULL,
      email VARCHAR(150) NOT NULL UNIQUE,
      papel_id UUID NOT NULL REFERENCES papeis(id),
      municipio VARCHAR(100),
      esta_ativo BOOLEAN NOT NULL DEFAULT TRUE
    )
  `);

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const migration = require("../../../db/migrations/1800000000001_create-notificacoes-table.cjs");
  const comandos: string[] = [];
  migration.up({ sql: (sql: string) => comandos.push(sql) });
  for (const sql of comandos) await pool.query(sql);
}

export interface NovoUsuario {
  nome: string;
  papel: "ADMINISTRADOR" | "GESTOR_PUBLICO" | "PESQUISADOR";
  municipio?: string | null;
  ativo?: boolean;
}

export async function cadastrarUsuario(pool: Pick<Pool, "query">, usuario: NovoUsuario): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO usuarios (nome, email, papel_id, municipio, esta_ativo)
     SELECT $1, $2, p.id, $3, $4 FROM papeis p WHERE p.nome = $5
     RETURNING id`,
    [
      usuario.nome,
      `${usuario.nome.toLowerCase().replaceAll(" ", ".")}@exemplo.com`,
      usuario.municipio ?? null,
      usuario.ativo ?? true,
      usuario.papel,
    ]
  );
  return rows[0].id;
}
