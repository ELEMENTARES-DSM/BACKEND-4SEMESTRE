import { randomUUID } from "node:crypto";
import { Pool } from "pg";

// Schema isolado com as colunas de estacoes, sensores e medidas que o servico-relatorios lê
// (as migrations reais são do gestao-estacoes e do servico-validacao), nos mesmos tipos.
export async function prepararSchemaRelatorios(pool: Pool, schema: string): Promise<void> {
  // O módulo db é carregado antes dos hooks: configurar o pool explicitamente.
  pool.options.connectionString = process.env.RELATORIOS_TEST_DATABASE_URL;
  pool.options.options = `-c search_path=${schema}`;
  await pool.query(`CREATE SCHEMA ${schema}`);

  await pool.query(`
    CREATE TABLE estacoes (
      id        UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      codigo    VARCHAR(30)  NOT NULL UNIQUE,
      nome      VARCHAR(120) NOT NULL,
      municipio VARCHAR(100) NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE sensores (
      id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      estacao_id     UUID        NOT NULL REFERENCES estacoes(id),
      tipo           VARCHAR(50) NOT NULL,
      unidade_medida VARCHAR(20) NOT NULL,
      codigo         VARCHAR(30)
    )
  `);
  await pool.query(`
    CREATE TABLE medidas (
      id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      sensor_id   UUID          NOT NULL REFERENCES sensores(id),
      unixtime    BIGINT        NOT NULL,
      valor_bruto NUMERIC(18,6) NOT NULL,
      valor       NUMERIC(12,6) NOT NULL,
      valida      BOOLEAN       NOT NULL DEFAULT TRUE,
      CONSTRAINT uq_medidas_sensor_unixtime UNIQUE (sensor_id, unixtime)
    )
  `);
  await pool.query("CREATE INDEX idx_medidas_unixtime ON medidas (unixtime)");
}

export async function apagarSchema(pool: Pool, schema: string): Promise<void> {
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  } finally {
    await pool.end();
  }
}

export function nomeDeSchema(prefixo: string): string {
  return `${prefixo}_${randomUUID().replaceAll("-", "")}`;
}

export async function cadastrarEstacao(
  pool: Pick<Pool, "query">,
  codigo: string,
  municipio = "São José dos Campos",
  nome = "Centro",
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    "INSERT INTO estacoes (codigo, nome, municipio) VALUES ($1, $2, $3) RETURNING id",
    [codigo, nome, municipio],
  );
  return rows[0].id;
}

export async function cadastrarSensor(
  pool: Pick<Pool, "query">,
  estacaoId: string,
  codigo: string,
  tipo = "Temperatura",
  unidade = "°C",
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO sensores (estacao_id, codigo, tipo, unidade_medida)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [estacaoId, codigo, tipo, unidade],
  );
  return rows[0].id;
}

export interface NovaMedida {
  unixtime: number;
  valor?: string;
  valorBruto?: string;
  valida?: boolean;
}

export async function cadastrarMedida(
  pool: Pick<Pool, "query">,
  sensorId: string,
  medida: NovaMedida,
): Promise<void> {
  await pool.query(
    "INSERT INTO medidas (sensor_id, unixtime, valor, valor_bruto, valida) VALUES ($1, $2, $3, $4, $5)",
    [sensorId, medida.unixtime, medida.valor ?? "23.4", medida.valorBruto ?? "24.9", medida.valida ?? true],
  );
}

// `quantidade` medidas de um sensor, uma por minuto a partir de `inicio`, num INSERT só.
export async function cadastrarSerie(
  pool: Pick<Pool, "query">,
  sensorId: string,
  inicio: number,
  quantidade: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO medidas (sensor_id, unixtime, valor, valor_bruto)
     SELECT $1, $2::bigint + n * 60, 20 + n % 10, 21 + n % 10 FROM generate_series(0, $3::int - 1) AS n`,
    [sensorId, inicio, quantidade],
  );
}
