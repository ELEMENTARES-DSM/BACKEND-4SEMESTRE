import { Pool } from "pg";

// Migrations CommonJS geradas pelo node-pg-migrate, aplicadas na ordem.
function aplicar(pool: Pool, arquivo: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const migration = require(arquivo);
  const comandos: string[] = [];
  migration.up({ sql: (sql: string) => comandos.push(sql) });
  return comandos.reduce<Promise<unknown>>((anterior, sql) => anterior.then(() => pool.query(sql)), Promise.resolve());
}

/**
 * Schema isolado para a consulta de alarmes (US-24): estacoes e sensores mínimos
 * (as migrations reais são do gestao-estacoes), as migrations reais de
 * regras_alerta deste serviço e as de medidas e alarmes do servico-validacao,
 * que é o dono da tabela alarmes.
 */
export async function prepararSchemaAlarmes(pool: Pool, schema: string): Promise<void> {
  pool.options.connectionString = process.env.ALERTAS_TEST_DATABASE_URL;
  pool.options.options = `-c search_path=${schema}`;
  await pool.query(`CREATE SCHEMA ${schema}`);

  await pool.query(`
    CREATE TABLE estacoes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      codigo VARCHAR(30) NOT NULL UNIQUE,
      nome VARCHAR(120) NOT NULL,
      municipio VARCHAR(100) NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE sensores (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      estacao_id UUID NOT NULL REFERENCES estacoes(id),
      tipo VARCHAR(50) NOT NULL,
      unidade_medida VARCHAR(20) NOT NULL,
      codigo VARCHAR(30),
      status VARCHAR(20) NOT NULL DEFAULT 'Ativo'
    )
  `);

  await aplicar(pool, "../../../db/migrations/1799999999999_create-regras-alerta.js");
  await aplicar(pool, "../../../db/migrations/1800000000000_ajusta-regras-alerta.cjs");
  await aplicar(pool, "../../../../../servico-validacao/src/db/migrations/1792502100000_create-medidas-table.cjs");
  await aplicar(pool, "../../../../../servico-validacao/src/db/migrations/1792900000000_create-alarmes-table.cjs");
}

export async function cadastrarSensor(
  pool: Pick<Pool, "query">,
  estacao: { codigo: string; nome: string; municipio: string },
  sensor: { codigo: string; tipo: string; unidade: string }
): Promise<{ estacaoId: string; sensorId: string }> {
  const { rows: [e] } = await pool.query<{ id: string }>(
    "INSERT INTO estacoes (codigo, nome, municipio) VALUES ($1, $2, $3) RETURNING id",
    [estacao.codigo, estacao.nome, estacao.municipio]
  );
  const { rows: [s] } = await pool.query<{ id: string }>(
    "INSERT INTO sensores (estacao_id, tipo, unidade_medida, codigo) VALUES ($1, $2, $3, $4) RETURNING id",
    [e.id, sensor.tipo, sensor.unidade, sensor.codigo]
  );
  return { estacaoId: e.id, sensorId: s.id };
}

export interface NovoAlarme {
  sensorId: string;
  estacaoId: string;
  municipio: string;
  regraNome: string;
  severidade: "ATENCAO" | "ALERTA" | "CRITICO";
  valor: string;
  limite: string;
  lidoEm: string;
  situacao?: "aberto" | "normalizado";
}

let unixtime = 1792400000;

/** Grava regra, medida e alarme como o servico-validacao faria (só para o teste). */
export async function gravarAlarme(pool: Pick<Pool, "query">, a: NovoAlarme): Promise<string> {
  const { rows: [regra] } = await pool.query<{ id: string }>(
    `INSERT INTO regras_alerta (sensor_id, nome, operador, valor_limite, severidade)
     VALUES ($1, $2, '>=', $3, $4) RETURNING id`,
    [a.sensorId, a.regraNome, a.limite, a.severidade]
  );
  unixtime += 300;
  const { rows: [medida] } = await pool.query<{ id: string }>(
    `INSERT INTO medidas (sensor_id, unixtime, valor_bruto, valor, staging_id, criado_em)
     VALUES ($1, $2, $3, $3, gen_random_uuid(), now()) RETURNING id`,
    [a.sensorId, unixtime, a.valor]
  );
  const normalizado = a.situacao === "normalizado";
  const { rows: [alarme] } = await pool.query<{ id: string }>(
    `INSERT INTO alarmes (regra_id, medida_id, sensor_id, estacao_id, municipio, valor, operador,
                          limite, severidade, situacao, lido_em, normalizado_em)
     VALUES ($1, $2, $3, $4, $5, $6, '>=', $7, $8, $9, $10, $11) RETURNING id`,
    [
      regra.id, medida.id, a.sensorId, a.estacaoId, a.municipio, a.valor, a.limite, a.severidade,
      normalizado ? "normalizado" : "aberto", a.lidoEm, normalizado ? a.lidoEm : null,
    ]
  );
  return alarme.id;
}
