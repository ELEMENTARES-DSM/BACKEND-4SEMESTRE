import { Pool, PoolClient } from "pg";
import { abrirBancoDeTeste } from "../../../tests/integration/ambiente";
import {
  abrirSchema,
  carregarMigration,
  executar,
  fecharSchema,
} from "../../../tests/integration/schema-descartavel";

/** Executa o SQL das migrations 907 e 908 num schema descartável do banco de teste. */
const SCHEMA = "mig_tipos_sensor_teste";

const criarTabela = carregarMigration("1790529879907_cria-tipos-sensor.cjs");
const carga = carregarMigration("1790529879908_carga-grandezas-iniciais.cjs");

let pool: Pool;
let client: PoolClient;

beforeAll(async () => {
  pool = abrirBancoDeTeste();
  client = await abrirSchema(pool, SCHEMA);
});

afterAll(async () => {
  await fecharSchema(pool, client, SCHEMA);
});

const existeTabela = async () => {
  const r = await client.query(
    `SELECT to_regclass('${SCHEMA}.tipos_sensor') IS NOT NULL AS existe`,
  );
  return r.rows[0].existe as boolean;
};

describe("migrations ...907 e ...908: catálogo tipos_sensor (US-39)", () => {
  it("deve criar a tabela e carregar as 8 grandezas com a agregação correta quando as migrations sobem", async () => {
    // Quando
    await executar(client, criarTabela.up);
    await executar(client, carga.up);

    // Então
    expect(await existeTabela()).toBe(true);
    const r = await client.query(
      `SELECT nome, unidade, faixa_min::text, faixa_max::text, agregacao
       FROM tipos_sensor ORDER BY nome`,
    );
    expect(r.rows).toEqual([
      { nome: "Direção do Vento", unidade: "°", faixa_min: "0.00", faixa_max: "360.00", agregacao: "media_circular" },
      { nome: "PM10", unidade: "µg/m³", faixa_min: "0.00", faixa_max: "1000.00", agregacao: "media" },
      { nome: "PM2.5", unidade: "µg/m³", faixa_min: "0.00", faixa_max: "1000.00", agregacao: "media" },
      { nome: "Precipitação", unidade: "mm", faixa_min: "0.00", faixa_max: "500.00", agregacao: "soma" },
      { nome: "Pressão Atmosférica", unidade: "hPa", faixa_min: "600.00", faixa_max: "1100.00", agregacao: "media" },
      { nome: "Temperatura", unidade: "°C", faixa_min: "-50.00", faixa_max: "60.00", agregacao: "media" },
      { nome: "Umidade Relativa", unidade: "%", faixa_min: "0.00", faixa_max: "100.00", agregacao: "media" },
      { nome: "Velocidade do Vento", unidade: "km/h", faixa_min: "0.00", faixa_max: "400.00", agregacao: "media" },
    ]);
  });

  it("deve manter as 8 linhas quando as migrations sobem de novo (idempotência)", async () => {
    // Quando
    await executar(client, criarTabela.up);
    await executar(client, carga.up);

    // Então
    const r = await client.query(`SELECT count(*)::int AS total FROM tipos_sensor`);
    expect(r.rows[0].total).toBe(8);
  });

  it("deve preservar a linha já cadastrada quando a carga encontra o nome existente", async () => {
    // Dado: o Administrador mudou a faixa da Temperatura antes da carga rodar de novo
    await client.query(`UPDATE tipos_sensor SET faixa_max = 70 WHERE nome = 'Temperatura'`);

    // Quando
    await executar(client, carga.up);

    // Então
    const r = await client.query(`SELECT faixa_max::text FROM tipos_sensor WHERE nome = 'Temperatura'`);
    expect(r.rows[0].faixa_max).toBe("70.00");
  });

  it("deve recusar faixa_min igual a faixa_max e agregação fora da lista no banco", async () => {
    await expect(
      client.query(`INSERT INTO tipos_sensor (nome, unidade, faixa_min, faixa_max) VALUES ('X1', 'u', 5, 5)`),
    ).rejects.toMatchObject({ code: "23514" });

    await expect(
      client.query(
        `INSERT INTO tipos_sensor (nome, unidade, faixa_min, faixa_max, agregacao)
         VALUES ('X2', 'u', 0, 5, 'mediana')`,
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("deve recusar nome repetido no banco (UNIQUE)", async () => {
    await expect(
      client.query(`INSERT INTO tipos_sensor (nome, unidade, faixa_min, faixa_max) VALUES ('PM10', 'u', 0, 5)`),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("deve remover só as 8 grandezas da carga e depois a tabela quando as migrations descem", async () => {
    // Dado: uma grandeza criada pelo Administrador depois da carga
    await client.query(
      `INSERT INTO tipos_sensor (nome, unidade, faixa_min, faixa_max) VALUES ('Nebulosidade', '%', 0, 100)`,
    );

    // Quando: desce a carga (908)
    await executar(client, carga.down);

    // Então: só a grandeza do Administrador ficou
    const r = await client.query(`SELECT nome FROM tipos_sensor`);
    expect(r.rows).toEqual([{ nome: "Nebulosidade" }]);

    // Quando: desce a tabela (907)
    await executar(client, criarTabela.down);

    // Então
    expect(await existeTabela()).toBe(false);
  });
});
