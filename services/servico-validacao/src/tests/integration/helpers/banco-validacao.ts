import { Pool } from "pg";
import { faixaDoCatalogo } from "../../helpers/catalogo";

// Schema isolado com estacoes, sensores e regras_alerta mínimos (as migrations
// reais são do gestao-estacoes e do alertas-notificacoes) e as migrations reais
// de medidas e alarmes do servico-validacao.
export async function prepararSchemaValidacao(pool: Pool, schema: string): Promise<void> {
  // O módulo db é carregado antes dos hooks: configurar o pool explicitamente.
  pool.options.connectionString = process.env.VALIDACAO_TEST_DATABASE_URL;
  pool.options.options = `-c search_path=${schema}`;
  await pool.query(`CREATE SCHEMA ${schema}`);

  await pool.query(`
    CREATE TABLE estacoes (
      id UUID PRIMARY KEY,
      municipio VARCHAR(100) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'Ativa'
    )
  `);
  // Só as colunas do catálogo (tipos_sensor, do gestao-estacoes) que o serviço lê (US-39).
  await pool.query(`
    CREATE TABLE tipos_sensor (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      nome VARCHAR(100) NOT NULL UNIQUE,
      unidade VARCHAR(20) NOT NULL,
      faixa_min NUMERIC(12,2) NOT NULL,
      faixa_max NUMERIC(12,2) NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE sensores (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      estacao_id UUID NOT NULL REFERENCES estacoes(id),
      tipo VARCHAR(100) NOT NULL DEFAULT 'Temperatura' REFERENCES tipos_sensor(nome),
      codigo VARCHAR(30),
      fator_conversao NUMERIC(12,6) NOT NULL DEFAULT 1.0,
      offset_calibracao NUMERIC(12,6) NOT NULL DEFAULT 0.0,
      status VARCHAR(20) NOT NULL DEFAULT 'Ativo'
    )
  `);

  // Só as colunas de regras_alerta que o servico-validacao lê (US-22).
  await pool.query(`
    CREATE TABLE regras_alerta (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      sensor_id UUID NOT NULL REFERENCES sensores(id),
      operador VARCHAR(5) NOT NULL,
      valor_limite NUMERIC(10,2) NOT NULL,
      severidade VARCHAR(20) NOT NULL,
      esta_ativo BOOLEAN NOT NULL DEFAULT TRUE,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
    )
  `);

  // Migrations CommonJS geradas pelo node-pg-migrate, na ordem do nome.
  for (const arquivo of [
    "1792502100000_create-medidas-table.cjs",
    "1792900000000_create-alarmes-table.cjs",
  ]) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const migration = require(`../../../db/migrations/${arquivo}`);
    const comandos: string[] = [];
    migration.up({ sql: (sql: string) => comandos.push(sql) });
    for (const sql of comandos) await pool.query(sql);
  }
}

export async function cadastrarEstacao(
  pool: Pick<Pool, "query">,
  id: string,
  municipio = "São José dos Campos",
  status = "Ativa",
): Promise<void> {
  await pool.query("INSERT INTO estacoes (id, municipio, status) VALUES ($1, $2, $3)", [
    id,
    municipio,
    status,
  ]);
}

export interface Grandeza {
  nome: string;
  unidade: string;
  faixa_min: string;
  faixa_max: string;
}

/** Cadastra ou atualiza uma grandeza no catálogo (o Administrador mudando a faixa, por exemplo). */
export async function cadastrarGrandeza(pool: Pick<Pool, "query">, grandeza: Grandeza): Promise<void> {
  await pool.query(
    `INSERT INTO tipos_sensor (nome, unidade, faixa_min, faixa_max)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (nome) DO UPDATE
       SET unidade = EXCLUDED.unidade,
           faixa_min = EXCLUDED.faixa_min,
           faixa_max = EXCLUDED.faixa_max`,
    [grandeza.nome, grandeza.unidade, grandeza.faixa_min, grandeza.faixa_max],
  );
}

export interface NovoSensor {
  estacaoId: string;
  codigo: string;
  /** Grandeza da carga inicial do catálogo, ou uma já cadastrada com cadastrarGrandeza. */
  tipo?: string;
  status?: "Ativo" | "Inativo";
  fator_conversao?: string;
  offset?: string;
}

export async function cadastrarSensor(
  pool: Pick<Pool, "query">,
  sensor: NovoSensor,
): Promise<string> {
  const tipo = sensor.tipo ?? "Temperatura";
  // O sensor referencia o catálogo por FK: as grandezas da carga inicial entram sob demanda
  // (sem sobrescrever uma faixa que o teste tenha alterado).
  const { rowCount } = await pool.query("SELECT 1 FROM tipos_sensor WHERE nome = $1", [tipo]);
  if (rowCount === 0) {
    await cadastrarGrandeza(pool, { nome: tipo, ...faixaDoCatalogo(tipo) });
  }

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO sensores (estacao_id, codigo, tipo, status, fator_conversao, offset_calibracao)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      sensor.estacaoId,
      sensor.codigo,
      tipo,
      sensor.status ?? "Ativo",
      sensor.fator_conversao ?? "1.0",
      sensor.offset ?? "0.0",
    ],
  );
  return rows[0].id;
}

export interface NovaRegra {
  sensorId: string;
  operador: ">" | ">=" | "<" | "<=" | "=";
  limite: string;
  severidade?: "ATENCAO" | "ALERTA" | "CRITICO";
  ativa?: boolean;
}

export async function cadastrarRegra(pool: Pick<Pool, "query">, regra: NovaRegra): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO regras_alerta (sensor_id, operador, valor_limite, severidade, esta_ativo)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [regra.sensorId, regra.operador, regra.limite, regra.severidade ?? "CRITICO", regra.ativa ?? true],
  );
  return rows[0].id;
}
