import { Pool, PoolClient } from "pg";
import { abrirBancoDeTeste } from "../../../tests/integration/ambiente";
import {
  abrirSchema,
  carregarMigration,
  executar,
  fecharSchema,
} from "../../../tests/integration/schema-descartavel";

/**
 * Migration ...909: sensores.tipo passa a referenciar o catálogo. Roda num
 * schema descartável, com as migrations anteriores aplicadas na ordem real.
 */
const SCHEMA = "mig_sensores_tipo_fk_teste";

const anteriores = [
  "1789524750000_create-estacoes-table.cjs",
  "1789524750001_create-sensores-table.cjs",
  "1790529879906_add-codigo-nome-sensores.cjs",
  "1790529879907_cria-tipos-sensor.cjs",
  "1790529879908_carga-grandezas-iniciais.cjs",
].map(carregarMigration);
const vinculo = carregarMigration("1790529879909_sensores-tipo-referencia-catalogo.cjs");

let pool: Pool;
let client: PoolClient;
let estacaoId: string;

const inserirSensor = (tipo: string, unidade = "u") =>
  client.query(
    `INSERT INTO sensores (estacao_id, tipo, unidade_medida) VALUES ($1, $2, $3)`,
    [estacaoId, tipo, unidade],
  );

const larguraDeTipo = async () => {
  const r = await client.query(
    `SELECT character_maximum_length AS largura
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = 'sensores' AND column_name = 'tipo'`,
    [SCHEMA],
  );
  return r.rows[0].largura as number;
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
});

afterAll(async () => {
  await fecharSchema(pool, client, SCHEMA);
});

describe("migration ...909: FK de sensores.tipo para o catálogo (US-39)", () => {
  it("deve manter o sensor que já existia quando a FK é criada", async () => {
    // Dado: sensor de uma das 5 grandezas antigas, criado sob o CHECK fixo
    await inserirSensor("Temperatura", "°C");
    await expect(inserirSensor("Radiação Solar")).rejects.toMatchObject({ code: "23514" });

    // Quando
    await executar(client, vinculo.up);

    // Então
    const r = await client.query(`SELECT tipo FROM sensores`);
    expect(r.rows).toEqual([{ tipo: "Temperatura" }]);
  });

  it("deve aceitar sensor de grandeza nova do catálogo e recusar grandeza fora dele (FK)", async () => {
    // Quando / Então
    await expect(inserirSensor("Direção do Vento", "°")).resolves.toBeDefined();
    await expect(inserirSensor("Radiação Solar")).rejects.toMatchObject({ code: "23503" });
  });

  it("deve manter a regra de um sensor por tipo por estação", async () => {
    await expect(inserirSensor("Direção do Vento", "°")).rejects.toMatchObject({ code: "23505" });
  });

  it("deve aceitar sensor de uma grandeza com nome de 100 caracteres quando a coluna foi alargada", async () => {
    // Dado
    const nome = "G".repeat(100);
    await client.query(
      `INSERT INTO tipos_sensor (nome, unidade, faixa_min, faixa_max) VALUES ($1, 'u', 0, 1)`,
      [nome],
    );

    // Quando / Então
    expect(await larguraDeTipo()).toBe(100);
    await expect(inserirSensor(nome)).resolves.toBeDefined();
  });

  it("deve recusar apagar do catálogo uma grandeza que tem sensor", async () => {
    await expect(
      client.query(`DELETE FROM tipos_sensor WHERE nome = 'Temperatura'`),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("deve poder subir de novo sem erro (idempotência)", async () => {
    await expect(executar(client, vinculo.up)).resolves.toBeUndefined();
  });

  it("deve bloquear o rollback quando algum sensor usa grandeza criada pelo catálogo", async () => {
    // Dado: o sensor de Direção do Vento criado acima

    // Quando
    const promessa = executar(client, vinculo.down);

    // Então: a migration aborta com a mensagem clara e nada é desfeito
    await expect(promessa).rejects.toThrow(/Rollback bloqueado/);
    await expect(inserirSensor("Radiação Solar")).rejects.toMatchObject({ code: "23503" });
  });

  it("deve voltar ao CHECK antigo quando o rollback roda sem sensores de grandeza nova", async () => {
    // Dado: sobram só sensores das 5 grandezas originais
    await client.query(`DELETE FROM sensores WHERE tipo NOT IN ('Temperatura')`);
    await client.query(`DELETE FROM tipos_sensor WHERE nome = $1`, ["G".repeat(100)]);

    // Quando
    await executar(client, vinculo.down);

    // Então
    expect(await larguraDeTipo()).toBe(50);
    await expect(inserirSensor("Precipitação")).rejects.toMatchObject({ code: "23514" });
    const r = await client.query(`SELECT tipo FROM sensores`);
    expect(r.rows).toEqual([{ tipo: "Temperatura" }]);
  });
});
