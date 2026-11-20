import { Pool, PoolClient } from "pg";
import { abrirBancoDeTeste } from "../../../tests/integration/ambiente";
import {
  abrirSchema,
  carregarMigration,
  executar,
  fecharSchema,
} from "../../../tests/integration/schema-descartavel";

/**
 * Migration ...912: índice único parcial de (estacao_id, codigo). Roda num
 * schema descartável, com as migrations anteriores na ordem real.
 */
const SCHEMA = "mig_codigo_unico_teste";

const anteriores = [
  "1789524750000_create-estacoes-table.cjs",
  "1789524750001_create-sensores-table.cjs",
  "1790529879906_add-codigo-nome-sensores.cjs",
  "1790529879907_cria-tipos-sensor.cjs",
  "1790529879908_carga-grandezas-iniciais.cjs",
  "1790529879909_sensores-tipo-referencia-catalogo.cjs",
  "1790529879910_add-unidade-leitura-sensores.cjs",
  "1790529879911_renomear-fator-ganho-sensores.cjs",
].map(carregarMigration);
const indiceCodigo = carregarMigration("1790529879912_indice-sensores-codigo-unico.cjs");

let pool: Pool;
let client: PoolClient;
let estacaoA: string;
let estacaoB: string;

const novaEstacao = async (codigo: string): Promise<string> => {
  const r = await client.query(
    `INSERT INTO estacoes (codigo, nome, municipio, latitude, longitude)
     VALUES ($1, 'Estação da migration', 'São José dos Campos', -23.18, -45.88)
     RETURNING id`,
    [codigo],
  );
  return r.rows[0].id;
};

const inserirSensor = (estacaoId: string, tipo: string, codigo: string | null) =>
  client.query(
    `INSERT INTO sensores (estacao_id, tipo, unidade_medida, codigo) VALUES ($1, $2, 'u', $3)`,
    [estacaoId, tipo, codigo],
  );

const existeIndice = async (): Promise<boolean> => {
  const r = await client.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = 'uq_sensores_estacao_codigo'`,
    [SCHEMA],
  );
  return r.rowCount === 1;
};

beforeAll(async () => {
  pool = abrirBancoDeTeste();
  client = await abrirSchema(pool, SCHEMA);
  for (const migration of anteriores) await executar(client, migration.up);
  estacaoA = await novaEstacao("EST-A");
  estacaoB = await novaEstacao("EST-B");
});

afterAll(async () => {
  await fecharSchema(pool, client, SCHEMA);
});

describe("migration ...912: código do sensor único por estação (US-39)", () => {
  it("deve abortar listando os repetidos quando já existem dois sensores com o mesmo código na estação", async () => {
    // Dado: dados antigos, antes do índice, com código repetido
    await inserirSensor(estacaoA, "Temperatura", "REPETIDO-01");
    await inserirSensor(estacaoA, "PM10", "REPETIDO-01");

    // Quando
    const promessa = executar(client, indiceCodigo.up);

    // Então: a mensagem diz o código e a estação, e o índice não é criado
    await expect(promessa).rejects.toThrow(/REPETIDO-01 na estacao .* \(2 sensores\)/);
    expect(await existeIndice()).toBe(false);

    // Limpeza do dado repetido
    await client.query(`DELETE FROM sensores WHERE codigo = 'REPETIDO-01' AND tipo = 'PM10'`);
  });

  it("deve criar o índice quando não há repetidos, mantendo os sensores sem código", async () => {
    // Dado: um sensor sem código (antigo) e um com código
    await inserirSensor(estacaoA, "Umidade Relativa", null);

    // Quando
    await executar(client, indiceCodigo.up);

    // Então
    expect(await existeIndice()).toBe(true);
    const r = await client.query(`SELECT count(*)::int AS total FROM sensores`);
    expect(r.rows[0].total).toBe(2);
  });

  it("deve recusar o mesmo código na mesma estação com a constraint do índice (23505)", async () => {
    await expect(inserirSensor(estacaoA, "PM2.5", "REPETIDO-01")).rejects.toMatchObject({
      code: "23505",
      constraint: "uq_sensores_estacao_codigo",
    });
  });

  it("deve aceitar o mesmo código em outra estação", async () => {
    await expect(inserirSensor(estacaoB, "Temperatura", "REPETIDO-01")).resolves.toBeDefined();
  });

  it("deve aceitar vários sensores sem código na mesma estação (índice parcial)", async () => {
    await expect(inserirSensor(estacaoA, "Velocidade do Vento", null)).resolves.toBeDefined();
    await expect(inserirSensor(estacaoA, "Direção do Vento", null)).resolves.toBeDefined();
  });

  it("deve manter a regra de um sensor por tipo por estação, com a constraint própria", async () => {
    await expect(inserirSensor(estacaoA, "Temperatura", "OUTRO-01")).rejects.toMatchObject({
      code: "23505",
      constraint: "uq_sensor_por_estacao",
    });
  });

  it("deve poder subir de novo sem erro (idempotência)", async () => {
    await expect(executar(client, indiceCodigo.up)).resolves.toBeUndefined();
  });

  it("deve remover o índice quando a migration desce, sem apagar sensores", async () => {
    // Quando
    await executar(client, indiceCodigo.down);

    // Então
    expect(await existeIndice()).toBe(false);
    const r = await client.query(`SELECT count(*)::int AS total FROM sensores`);
    expect(r.rows[0].total).toBeGreaterThan(0);
  });
});
