import { Pool, PoolClient } from "pg";
import { abrirBancoDeTeste } from "../../../tests/integration/ambiente";
import {
  abrirSchema,
  carregarMigration,
  executar,
  fecharSchema,
} from "../../../tests/integration/schema-descartavel";

/**
 * Migration ...910: sensores.unidade_leitura (opcional). Roda num schema
 * descartável, com as migrations anteriores aplicadas na ordem real.
 */
const SCHEMA = "mig_unidade_leitura_teste";

const anteriores = [
  "1789524750000_create-estacoes-table.cjs",
  "1789524750001_create-sensores-table.cjs",
  "1790529879906_add-codigo-nome-sensores.cjs",
  "1790529879907_cria-tipos-sensor.cjs",
  "1790529879908_carga-grandezas-iniciais.cjs",
  "1790529879909_sensores-tipo-referencia-catalogo.cjs",
].map(carregarMigration);
const unidadeLeitura = carregarMigration("1790529879910_add-unidade-leitura-sensores.cjs");

let pool: Pool;
let client: PoolClient;
let estacaoId: string;

const colunaExiste = async () => {
  const r = await client.query(
    `SELECT character_maximum_length AS largura, is_nullable
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = 'sensores' AND column_name = 'unidade_leitura'`,
    [SCHEMA],
  );
  return r.rows[0] as { largura: number; is_nullable: string } | undefined;
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
  // Sensor que já existia antes da coluna.
  await client.query(
    `INSERT INTO sensores (estacao_id, tipo, unidade_medida) VALUES ($1, 'Temperatura', '°C')`,
    [estacaoId],
  );
});

afterAll(async () => {
  await fecharSchema(pool, client, SCHEMA);
});

describe("migration ...910: sensores.unidade_leitura (US-39)", () => {
  it("deve criar a coluna opcional de até 20 caracteres e manter NULL no sensor que já existia", async () => {
    // Quando
    await executar(client, unidadeLeitura.up);

    // Então
    expect(await colunaExiste()).toEqual({ largura: 20, is_nullable: "YES" });
    const r = await client.query(`SELECT unidade_leitura FROM sensores`);
    expect(r.rows).toEqual([{ unidade_leitura: null }]);
  });

  it("deve gravar 20 caracteres e recusar 21 (borda da coluna)", async () => {
    const inserir = (tipo: string, valor: string) =>
      client.query(
        `INSERT INTO sensores (estacao_id, tipo, unidade_medida, unidade_leitura) VALUES ($1, $2, 'u', $3)`,
        [estacaoId, tipo, valor],
      );

    await expect(inserir("Umidade Relativa", "u".repeat(20))).resolves.toBeDefined();
    await expect(inserir("PM10", "u".repeat(21))).rejects.toMatchObject({ code: "22001" });
  });

  it("deve poder subir de novo sem erro (idempotência)", async () => {
    await expect(executar(client, unidadeLeitura.up)).resolves.toBeUndefined();
  });

  it("deve remover a coluna quando a migration desce, sem apagar os sensores", async () => {
    // Quando
    await executar(client, unidadeLeitura.down);

    // Então
    expect(await colunaExiste()).toBeUndefined();
    const r = await client.query(`SELECT count(*)::int AS total FROM sensores`);
    expect(r.rows[0].total).toBe(2);
  });
});
