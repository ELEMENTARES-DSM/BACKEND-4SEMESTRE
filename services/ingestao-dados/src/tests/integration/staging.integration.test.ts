import { randomUUID } from "node:crypto";
import { pool } from "../../config/db";
import { processarMensagem } from "../../services/processar-mensagem.service";
import { logger } from "../../utils/logger";

// Execute somente contra um banco de teste; cada execução usa um schema isolado.
const integration = process.env.STAGING_TEST_DATABASE_URL ? describe : describe.skip;

integration("staging PostgreSQL", () => {
  const schema = `staging_test_${randomUUID().replaceAll("-", "")}`;
  const mensagem = {
    estacaoId: randomUUID(),
    topico: "estacoes/leitura",
    recebidoEm: "2026-10-14T12:00:05Z",
    payloadBruto: '{ "timestamp":"2026-10-14T12:00:00Z", "leituras":[{"sensor":"temperatura","valor":25}] }',
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

  it("grava aceita com dados completos", async () => {
    expect(await processarMensagem(mensagem)).toBe("recebida");
    const { rows } = await pool.query("SELECT * FROM staging_telemetria");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      estacao_uuid: mensagem.estacaoId,
      status: "recebida",
      payload_bruto: mensagem.payloadBruto,
      unixtime: String(Date.parse("2026-10-14T12:00:00Z") / 1000),
      motivo_rejeicao: null,
    });
    expect(rows[0].criado_em.toISOString()).toBe("2026-10-14T12:00:05.000Z");
  });

  it("grava rejeitada não JSON exatamente como recebida", async () => {
    const payloadBruto = "  inválido\n";
    expect(await processarMensagem({ ...mensagem, payloadBruto })).toBe("rejeitada");
    const { rows } = await pool.query("SELECT * FROM staging_telemetria");
    expect(rows[0]).toMatchObject({ status: "rejeitada", payload_bruto: payloadBruto,
      payload: null, unixtime: null, motivo_rejeicao: "Payload malformado" });
  });

  it("aceita rejeição de negócio da US-12 sem exigir estação cadastrada", async () => {
    await processarMensagem(mensagem, "Estação inativa");
    const { rows } = await pool.query("SELECT * FROM staging_telemetria");
    expect(rows[0]).toMatchObject({ status: "rejeitada", motivo_rejeicao: "Estação inativa",
      payload: JSON.parse(mensagem.payloadBruto) });
  });

  it("impede duplicatas simultâneas", async () => {
    const resultados = await Promise.all([
      processarMensagem(mensagem), processarMensagem(mensagem),
    ]);
    expect(resultados.sort()).toEqual(["duplicata", "recebida"]);
    const { rows } = await pool.query("SELECT count(*) FROM staging_telemetria");
    expect(rows[0].count).toBe("1");
  });

  it("rejeitadas não bloqueiam uma aceita da mesma chave", async () => {
    await processarMensagem(mensagem, "Estação inativa");
    await processarMensagem(mensagem, "Estação inativa");
    expect(await processarMensagem(mensagem)).toBe("recebida");
    expect(await processarMensagem(mensagem)).toBe("duplicata");
    const { rows } = await pool.query("SELECT count(*) FROM staging_telemetria");
    expect(rows[0].count).toBe("3");
  });

  it("o índice continua impedindo duplicata após mudança de status", async () => {
    await processarMensagem(mensagem);
    await pool.query("UPDATE staging_telemetria SET status = 'publicada'");
    expect(await processarMensagem(mensagem)).toBe("duplicata");
  });
});
