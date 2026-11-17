import { Pool, PoolClient } from "pg";
import { abrirBancoDeTeste } from "../../../tests/integration/ambiente";
import {
  abrirSchema,
  carregarMigration,
  executar,
  fecharSchema,
} from "../../../tests/integration/schema-descartavel";

/**
 * Migration ...911: fator -> fator_conversao e ganho -> offset_calibracao.
 * Roda num schema descartável, com as migrations anteriores na ordem real.
 */
const SCHEMA = "mig_renomeio_sensores_teste";

const anteriores = [
  "1789524750000_create-estacoes-table.cjs",
  "1789524750001_create-sensores-table.cjs",
  "1790529879906_add-codigo-nome-sensores.cjs",
  "1790529879907_cria-tipos-sensor.cjs",
  "1790529879908_carga-grandezas-iniciais.cjs",
  "1790529879909_sensores-tipo-referencia-catalogo.cjs",
  "1790529879910_add-unidade-leitura-sensores.cjs",
].map(carregarMigration);
const renomeio = carregarMigration("1790529879911_renomear-fator-ganho-sensores.cjs");

let pool: Pool;
let client: PoolClient;
let estacaoId: string;

const colunas = async (): Promise<string[]> => {
  const r = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = 'sensores' ORDER BY column_name`,
    [SCHEMA],
  );
  return r.rows.map((linha) => linha.column_name as string);
};

beforeAll(async () => {
  pool = abrirBancoDeTeste();
  client = await abrirSchema(pool, SCHEMA);
  for (const migration of anteriores) await executar(client, migration.up);

  const estacao = await client.query(
    `INSERT INTO estacoes (codigo, nome, municipio, latitude, longitude)
     VALUES ('EST-MIG', 'Estação da migration', 'São José dos Campos', -23.18, -45.88)
     RETURNING id`,
  );
  estacaoId = estacao.rows[0].id;
  // Sensores que já existiam, com calibração própria e com os valores padrão.
  await client.query(
    `INSERT INTO sensores (estacao_id, tipo, unidade_medida, fator, ganho)
     VALUES ($1, 'Temperatura', '°C', 1.005, -0.025)`,
    [estacaoId],
  );
  await client.query(
    `INSERT INTO sensores (estacao_id, tipo, unidade_medida) VALUES ($1, 'PM10', 'µg/m³')`,
    [estacaoId],
  );
});

afterAll(async () => {
  await fecharSchema(pool, client, SCHEMA);
});

describe("migration ...911: renomeio fator/ganho (US-39)", () => {
  it("deve renomear as colunas e manter os valores dos sensores que já existiam", async () => {
    // Quando
    await executar(client, renomeio.up);

    // Então
    const nomes = await colunas();
    expect(nomes).toEqual(expect.arrayContaining(["fator_conversao", "offset_calibracao"]));
    expect(nomes).not.toContain("fator");
    expect(nomes).not.toContain("ganho");

    const r = await client.query(
      `SELECT tipo, fator_conversao::text AS fator, offset_calibracao::text AS offset
       FROM sensores ORDER BY tipo`,
    );
    expect(r.rows).toEqual([
      { tipo: "PM10", fator: "1.000000", offset: "0.000000" },
      { tipo: "Temperatura", fator: "1.005000", offset: "-0.025000" },
    ]);
  });

  it("deve manter os valores padrão fator 1 e offset 0 em sensor novo", async () => {
    // Quando
    const r = await client.query(
      `INSERT INTO sensores (estacao_id, tipo, unidade_medida) VALUES ($1, 'PM2.5', 'µg/m³')
       RETURNING fator_conversao::text AS fator, offset_calibracao::text AS offset`,
      [estacaoId],
    );

    // Então
    expect(r.rows[0]).toEqual({ fator: "1.000000", offset: "0.000000" });
  });

  it("deve entregar o offset pelo alias, porque a coluna não pode se chamar offset (palavra reservada do PostgreSQL)", async () => {
    // O alias devolve o valor com o nome do campo da API
    const r = await client.query(
      `SELECT offset_calibracao AS "offset" FROM sensores WHERE tipo = 'Temperatura'`,
    );
    expect(r.rows[0].offset).toBe("-0.025000");

    // A coluna real não se chama offset: o nome qualificado é aceito pelo parser, mas não existe (42703)
    await expect(client.query(`SELECT s.offset FROM sensores s`)).rejects.toMatchObject({ code: "42703" });

    // E offset sem aspas, sozinho, é erro de sintaxe (42601): por isso a coluna é offset_calibracao
    await expect(client.query(`SELECT offset FROM sensores`)).rejects.toMatchObject({ code: "42601" });
    await expect(client.query(`CREATE TEMP TABLE sem_aspas (offset int)`)).rejects.toMatchObject({ code: "42601" });
  });

  it("deve poder subir de novo sem erro (idempotência)", async () => {
    await expect(executar(client, renomeio.up)).resolves.toBeUndefined();
    expect(await colunas()).toEqual(expect.arrayContaining(["fator_conversao", "offset_calibracao"]));
  });

  it("deve voltar aos nomes antigos, com os valores, quando a migration desce", async () => {
    // Quando
    await executar(client, renomeio.down);

    // Então
    const nomes = await colunas();
    expect(nomes).toEqual(expect.arrayContaining(["fator", "ganho"]));
    expect(nomes).not.toContain("fator_conversao");
    expect(nomes).not.toContain("offset_calibracao");
    const r = await client.query(`SELECT fator::text AS fator, ganho::text AS ganho FROM sensores WHERE tipo = 'Temperatura'`);
    expect(r.rows[0]).toEqual({ fator: "1.005000", ganho: "-0.025000" });
  });
});
