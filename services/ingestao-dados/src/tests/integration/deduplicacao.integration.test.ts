import { randomUUID } from "node:crypto";
import { pool } from "../../config/db";
import { MensagemIngestaoInput } from "../../dto/mensagem-ingestao.dto";
import { processarMensagem } from "../../services/processar-mensagem.service";
import { logger } from "../../utils/logger";

// Critérios da TASK 13.01 (duplicata por estação e timestamp).
// Execute somente contra um banco de teste; cada execução usa um schema isolado.
const integration = process.env.STAGING_TEST_DATABASE_URL ? describe : describe.skip;

integration("deduplicação na staging PostgreSQL", () => {
  const schema = `dedup_test_${randomUUID().replaceAll("-", "")}`;

  const mensagem = (
    estacaoId: string,
    timestamp: string,
    extras: Partial<MensagemIngestaoInput> = {},
  ): MensagemIngestaoInput => ({
    estacaoId,
    topico: "estacoes/leitura",
    recebidoEm: "2026-10-14T12:00:05Z",
    payloadBruto: `{ "timestamp":"${timestamp}", "leituras":[{"sensor":"temperatura","valor":25}] }`,
    ...extras,
  });

  const contarLinhas = async (): Promise<string> => {
    const { rows } = await pool.query("SELECT count(*) FROM staging_telemetria");
    return rows[0].count;
  };

  beforeAll(async () => {
    // O módulo db é carregado antes dos hooks: configurar o pool explicitamente.
    pool.options.connectionString = process.env.STAGING_TEST_DATABASE_URL;
    pool.options.options = `-c search_path=${schema}`;
    await pool.query(`CREATE SCHEMA ${schema}`);
    // Migration CommonJS gerada pelo node-pg-migrate.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const migration = require("../../db/migrations/1791986171448_create-staging-telemetria.cjs");
    const comandos: string[] = [];
    migration.up({ sql: (sql: string) => comandos.push(sql) });
    for (const sql of comandos) await pool.query(sql);
    jest.spyOn(logger, "warn").mockImplementation(() => undefined);
  });

  afterAll(async () => {
    try {
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await pool.end();
      jest.restoreAllMocks();
    }
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE staging_telemetria");
  });

  it("mesma estação e mesmo timestamp: ignora a segunda e não altera a original", async () => {
    const estacaoId = randomUUID();
    const original = mensagem(estacaoId, "2026-10-14T12:00:00Z");
    // Reenvio com outro horário de recebimento e outro espaçamento, mesmo timestamp.
    const reenvio = mensagem(estacaoId, "2026-10-14T12:00:00Z", {
      recebidoEm: "2026-10-14T12:00:30Z",
      payloadBruto: '{"timestamp":"2026-10-14T12:00:00Z","leituras":[{"sensor":"temperatura","valor":25}]}',
    });

    expect(await processarMensagem(original)).toBe("recebida");
    const { rows: antes } = await pool.query(
      "SELECT status, criado_em, payload_bruto FROM staging_telemetria",
    );

    expect(await processarMensagem(reenvio)).toBe("duplicata");
    const { rows: depois } = await pool.query(
      "SELECT status, criado_em, payload_bruto FROM staging_telemetria",
    );

    expect(depois).toHaveLength(1);
    expect(depois[0]).toEqual(antes[0]);
    expect(depois[0]).toMatchObject({ status: "recebida", payload_bruto: original.payloadBruto });
    expect(depois[0].criado_em.toISOString()).toBe("2026-10-14T12:00:05.000Z");
  });

  it("mesmo instante com fuso diferente é duplicata", async () => {
    const estacaoId = randomUUID();

    expect(await processarMensagem(mensagem(estacaoId, "2026-10-14T21:00:00-03:00"))).toBe("recebida");
    expect(await processarMensagem(mensagem(estacaoId, "2026-10-15T00:00:00Z"))).toBe("duplicata");
    expect(await contarLinhas()).toBe("1");
  });

  it("mesma estação com horário diferente grava as duas", async () => {
    const estacaoId = randomUUID();

    expect(await processarMensagem(mensagem(estacaoId, "2026-10-14T12:00:00Z"))).toBe("recebida");
    expect(await processarMensagem(mensagem(estacaoId, "2026-10-14T12:00:01Z"))).toBe("recebida");
    expect(await contarLinhas()).toBe("2");
  });

  it("estação diferente com o mesmo horário grava as duas", async () => {
    expect(await processarMensagem(mensagem(randomUUID(), "2026-10-14T12:00:00Z"))).toBe("recebida");
    expect(await processarMensagem(mensagem(randomUUID(), "2026-10-14T12:00:00Z"))).toBe("recebida");
    expect(await contarLinhas()).toBe("2");
  });

  it("10 cópias idênticas simultâneas: só uma é gravada", async () => {
    const copia = mensagem(randomUUID(), "2026-10-14T12:00:00Z");

    const resultados = await Promise.all(
      Array.from({ length: 10 }, () => processarMensagem(copia)),
    );

    expect(resultados.filter((r) => r === "recebida")).toHaveLength(1);
    expect(resultados.filter((r) => r === "duplicata")).toHaveLength(9);
    expect(await contarLinhas()).toBe("1");
  });

  it("dois timestamps no mesmo segundo são duplicata", async () => {
    // A chave é o unixtime em segundos (decisão do índice): frações são truncadas.
    const estacaoId = randomUUID();

    expect(await processarMensagem(mensagem(estacaoId, "2026-10-14T12:00:00.200Z"))).toBe("recebida");
    expect(await processarMensagem(mensagem(estacaoId, "2026-10-14T12:00:00.700Z"))).toBe("duplicata");
    expect(await contarLinhas()).toBe("1");
  });
});
