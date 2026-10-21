import { describe, it, expect, beforeAll, beforeEach, afterAll } from "@jest/globals";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { EventoTelemetriaDTO } from "../../dto/evento-telemetria.dto";
import { processarEventoTelemetria } from "../../services/processar-telemetria.service";

// TASK 18.01 contra Postgres real: só roda com VALIDACAO_TEST_DATABASE_URL.
// Cada execução usa um schema isolado com estacoes/sensores mínimas e a tabela
// medidas criada pela migration.
const DATABASE_URL = process.env.VALIDACAO_TEST_DATABASE_URL;
const integration = DATABASE_URL ? describe : describe.skip;

integration("sensor inativo e inexistente (integração)", () => {
  const schema = `validacao_test_${randomUUID().replaceAll("-", "")}`;
  let db: Pool;
  let estacaoId: string;

  const inserirSensor = async (
    codigo: string,
    status: "Ativo" | "Inativo",
  ): Promise<string> => {
    const id = randomUUID();
    await db.query(
      `INSERT INTO sensores (id, estacao_id, codigo, status, fator, ganho)
       VALUES ($1, $2, $3, $4, 1.000000, 0.000000)`,
      [id, estacaoId, codigo, status],
    );
    return id;
  };

  const evento = (
    leituras: EventoTelemetriaDTO["leituras"],
    unixtime = 1792411200,
  ): EventoTelemetriaDTO => ({
    staging_id: randomUUID(),
    estacao_uuid: estacaoId,
    unixtime,
    leituras,
  });

  const processar = (ev: EventoTelemetriaDTO) =>
    processarEventoTelemetria(ev, { dbPool: db });

  const medidas = async () =>
    (await db.query<{ sensor_id: string }>("SELECT sensor_id FROM medidas")).rows;

  beforeAll(async () => {
    db = new Pool({
      connectionString: DATABASE_URL,
      options: `-c search_path=${schema}`,
    });
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`CREATE TABLE estacoes (id UUID PRIMARY KEY, municipio VARCHAR(100) NOT NULL)`);
    await db.query(`
      CREATE TABLE sensores (
        id UUID PRIMARY KEY,
        estacao_id UUID NOT NULL REFERENCES estacoes(id),
        codigo VARCHAR(30),
        status VARCHAR(20) NOT NULL,
        fator NUMERIC(12,6) NOT NULL,
        ganho NUMERIC(12,6) NOT NULL
      )
    `);
    // Migration CommonJS gerada pelo node-pg-migrate.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const migration = require("../../db/migrations/1792502100000_create-medidas-table.cjs");
    const comandos: string[] = [];
    migration.up({ sql: (sql: string) => comandos.push(sql) });
    for (const sql of comandos) await db.query(sql);
  });

  afterAll(async () => {
    try {
      await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await db.end();
    }
  });

  beforeEach(async () => {
    await db.query("TRUNCATE medidas, sensores, estacoes");
    estacaoId = randomUUID();
    await db.query("INSERT INTO estacoes (id, municipio) VALUES ($1, 'São José dos Campos')", [
      estacaoId,
    ]);
  });

  it("T-01 ativo, PM-01 inativo e X-99 inexistente: grava só a medida do T-01", async () => {
    const idT01 = await inserirSensor("T-01", "Ativo");
    await inserirSensor("PM-01", "Inativo");

    const resultado = await processar(
      evento([
        { sensor: "T-01", valor: 25.4 },
        { sensor: "PM-01", valor: 12 },
        { sensor: "X-99", valor: 7 },
      ]),
    );

    expect(await medidas()).toEqual([{ sensor_id: idT01 }]);
    expect(resultado.inativas.map((i) => i.leitura.sensor)).toEqual(["PM-01"]);
    expect(resultado.inexistentes).toEqual([{ sensor: "X-99", valor: 7 }]);
  });

  it("todos inativos: nenhuma linha em medidas", async () => {
    await inserirSensor("T-01", "Inativo");
    await inserirSensor("U-01", "Inativo");
    await inserirSensor("PM-01", "Inativo");

    const resultado = await processar(
      evento([
        { sensor: "T-01", valor: 1 },
        { sensor: "U-01", valor: 2 },
        { sensor: "PM-01", valor: 3 },
      ]),
    );

    expect(await medidas()).toHaveLength(0);
    expect(resultado.inativas).toHaveLength(3);
  });

  it("reativação: o evento seguinte, com o sensor Ativo, grava", async () => {
    const id = await inserirSensor("PM-01", "Inativo");

    await processar(evento([{ sensor: "PM-01", valor: 12 }], 1792411200));
    expect(await medidas()).toHaveLength(0);

    await db.query("UPDATE sensores SET status = 'Ativo' WHERE id = $1", [id]);
    await processar(evento([{ sensor: "PM-01", valor: 12 }], 1792411260));

    expect(await medidas()).toEqual([{ sensor_id: id }]);
  });

  it("código repetido na estação (um inativo e um ativo): grava pelo ativo", async () => {
    await inserirSensor("PM-01", "Inativo");
    const idAtivo = await inserirSensor("PM-01", "Ativo");
    await inserirSensor("PM-01", "Inativo");

    const resultado = await processar(evento([{ sensor: "PM-01", valor: 12 }]));

    expect(await medidas()).toEqual([{ sensor_id: idAtivo }]);
    expect(resultado.inativas).toEqual([]);
  });
});
