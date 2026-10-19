import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { buscarSensorDaEstacao } from "../../repositories/sensor.repository";

// Integração com Postgres real: só roda com VALIDACAO_TEST_DATABASE_URL.
// Cada execução usa um schema isolado com uma tabela sensores mínima.
const DATABASE_URL = process.env.VALIDACAO_TEST_DATABASE_URL;
const integration = DATABASE_URL ? describe : describe.skip;

integration("sensor.repository (integração)", () => {
  const schema = `validacao_test_${randomUUID().replaceAll("-", "")}`;
  let db: Pool;

  const inserirSensor = async (
    estacaoId: string,
    codigo: string,
    status: "Ativo" | "Inativo",
    fator = "1.000000",
    ganho = "0.000000",
  ): Promise<string> => {
    const id = randomUUID();
    await db.query(
      `INSERT INTO sensores (id, estacao_id, codigo, status, fator, ganho)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, estacaoId, codigo, status, fator, ganho],
    );
    return id;
  };

  beforeAll(async () => {
    db = new Pool({
      connectionString: DATABASE_URL,
      options: `-c search_path=${schema}`,
    });
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`
      CREATE TABLE sensores (
        id UUID PRIMARY KEY,
        estacao_id UUID NOT NULL,
        codigo VARCHAR(30),
        status VARCHAR(20) NOT NULL,
        fator NUMERIC(12,6) NOT NULL,
        ganho NUMERIC(12,6) NOT NULL
      )
    `);
  });

  afterAll(async () => {
    try {
      await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await db.end();
    }
  });

  it("encontra sensor ativo com fator e ganho numéricos", async () => {
    const estacao = randomUUID();
    const id = await inserirSensor(estacao, "T-01", "Ativo", "1.250000", "-0.500000");

    const sensor = await buscarSensorDaEstacao(estacao, "T-01", db);

    expect(sensor).toEqual({ id, codigo: "T-01", status: "Ativo", fator: 1.25, ganho: -0.5 });
  });

  it("encontra sensor inativo com status Inativo", async () => {
    const estacao = randomUUID();
    await inserirSensor(estacao, "PM-01", "Inativo");

    const sensor = await buscarSensorDaEstacao(estacao, "PM-01", db);

    expect(sensor?.status).toBe("Inativo");
  });

  it("retorna null para código inexistente", async () => {
    const estacao = randomUUID();
    await inserirSensor(estacao, "T-01", "Ativo");

    expect(await buscarSensorDaEstacao(estacao, "X-99", db)).toBeNull();
  });

  it("retorna null para código de outra estação", async () => {
    await inserirSensor(randomUUID(), "T-01", "Ativo");

    expect(await buscarSensorDaEstacao(randomUUID(), "T-01", db)).toBeNull();
  });

  it("com código repetido (um inativo e um ativo), retorna o ativo", async () => {
    const estacao = randomUUID();
    await inserirSensor(estacao, "U-01", "Inativo");
    const idAtivo = await inserirSensor(estacao, "U-01", "Ativo");
    await inserirSensor(estacao, "U-01", "Inativo");

    const sensor = await buscarSensorDaEstacao(estacao, "U-01", db);

    expect(sensor).toMatchObject({ id: idAtivo, status: "Ativo" });
  });

  it("após reativação, a próxima busca retorna Ativo", async () => {
    const estacao = randomUUID();
    const id = await inserirSensor(estacao, "PM-01", "Inativo");
    expect((await buscarSensorDaEstacao(estacao, "PM-01", db))?.status).toBe("Inativo");

    await db.query("UPDATE sensores SET status = 'Ativo' WHERE id = $1", [id]);

    expect((await buscarSensorDaEstacao(estacao, "PM-01", db))?.status).toBe("Ativo");
  });
});
