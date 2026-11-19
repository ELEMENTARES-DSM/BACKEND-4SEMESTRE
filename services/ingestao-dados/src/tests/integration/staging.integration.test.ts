import { randomUUID } from "node:crypto";
import { pool } from "../../config/db";
import { encerrarValkey, valkey } from "../../config/valkey";
import { chaveMensagem } from "../../repositories/staging-valkey.repository";
import { logger } from "../../utils/logger";
import { cadastrarEstacao, criarTabelaEstacoes } from "./helpers/estacoes";
import { gravarEVerificar, usarValkeyDeTeste } from "./helpers/valkey";

// Integração com PostgreSQL e Valkey de teste; cada execução usa um schema isolado.
const integration =
  process.env.STAGING_TEST_DATABASE_URL && process.env.VALKEY_TEST_URL ? describe : describe.skip;

integration("TASK 14.02 · staging_telemetria gravada a partir do Valkey", () => {
  const schema = `staging_test_${randomUUID().replaceAll("-", "")}`;
  const estacaoId = randomUUID();
  const mensagem = {
    topico: `pulso/estacoes/${estacaoId}/telemetria`,
    recebidoEm: "2026-10-14T12:00:05Z",
    payloadBruto: '{ "timestamp":"2026-10-14T12:00:00Z", "leituras":[{"sensor":"temperatura","valor":25}] }',
  };

  beforeAll(async () => {
    // O módulo db é carregado antes dos hooks: configurar o pool explicitamente.
    pool.options.connectionString = process.env.STAGING_TEST_DATABASE_URL;
    pool.options.options = `-c search_path=${schema}`;
    await pool.query(`CREATE SCHEMA ${schema}`);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const migration = require("../../db/migrations/1791986171448_create-staging-telemetria.cjs");
    const comandos: string[] = [];
    migration.up({ sql: (sql: string) => comandos.push(sql) });
    for (const sql of comandos) await pool.query(sql);
    await criarTabelaEstacoes(pool);
    await usarValkeyDeTeste(1);
  });

  afterAll(async () => {
    try {
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await pool.end();
      await encerrarValkey();
    }
  });

  beforeEach(async () => {
    jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    jest.spyOn(logger, "info").mockImplementation(() => undefined);
    await pool.query("TRUNCATE staging_telemetria, estacoes");
    await cadastrarEstacao(pool, estacaoId);
  });

  it("deve gravar a aceita com dados completos e o mesmo id do Valkey quando a leitura é válida", async () => {
    // Dado (Arrange)
    // Quando (Act)
    const resultado = await gravarEVerificar(mensagem);

    // Então (Assert)
    expect(resultado).toBe("pendente");
    const { rows } = await pool.query("SELECT * FROM staging_telemetria");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      estacao_uuid: estacaoId,
      status: "recebida",
      payload_bruto: mensagem.payloadBruto,
      unixtime: String(Date.parse("2026-10-14T12:00:00Z") / 1000),
      motivo_rejeicao: null,
    });
    expect(rows[0].criado_em.toISOString()).toBe("2026-10-14T12:00:05.000Z");
    expect(await valkey().exists(chaveMensagem(rows[0].id))).toBe(1);
  });

  it("deve gravar a recusada exatamente como recebida quando o conteúdo não é JSON", async () => {
    // Dado (Arrange)
    const payloadBruto = "  inválido\n";

    // Quando (Act)
    const resultado = await gravarEVerificar({ ...mensagem, payloadBruto });

    // Então (Assert)
    expect(resultado).toBe("recusada");
    const { rows } = await pool.query("SELECT * FROM staging_telemetria");
    expect(rows[0]).toMatchObject({
      status: "rejeitada", payload_bruto: payloadBruto, payload: null, unixtime: null, motivo_rejeicao: "Payload malformado",
    });
  });

  it("deve gravar \"Timestamp fora da faixa\" com unixtime e não mexer no último sinal quando a leitura é de 1970", async () => {
    // Dado (Arrange)
    const payloadBruto = '{ "timestamp":"1970-01-01T00:00:00Z", "leituras":[{"sensor":"temperatura","valor":25}] }';
    await pool.query("UPDATE estacoes SET ultimo_ping = $1 WHERE id = $2", ["2026-10-13T10:00:00Z", estacaoId]);

    // Quando (Act)
    const resultado = await gravarEVerificar({ ...mensagem, payloadBruto });

    // Então (Assert)
    expect(resultado).toBe("recusada");
    const { rows } = await pool.query("SELECT * FROM staging_telemetria");
    expect(rows[0]).toMatchObject({ status: "rejeitada", motivo_rejeicao: "Timestamp fora da faixa", unixtime: "0" });
    const estacao = await pool.query("SELECT ultimo_ping FROM estacoes WHERE id = $1", [estacaoId]);
    expect(estacao.rows[0].ultimo_ping.toISOString()).toBe("2026-10-13T10:00:00.000Z");
  });

  it("deve gravar a recusa de negócio da US-12 com o JSON quando a estação está inativa", async () => {
    // Dado (Arrange)
    await cadastrarEstacao(pool, estacaoId, "Inativa");

    // Quando (Act)
    await gravarEVerificar(mensagem);

    // Então (Assert)
    const { rows } = await pool.query("SELECT * FROM staging_telemetria");
    expect(rows[0]).toMatchObject({
      status: "rejeitada", motivo_rejeicao: "Estação inativa", payload: JSON.parse(mensagem.payloadBruto),
    });
  });

  it("deve gravar só uma quando duas iguais são verificadas ao mesmo tempo", async () => {
    // Dado (Arrange)
    // Quando (Act)
    const resultados = await Promise.all([gravarEVerificar(mensagem), gravarEVerificar(mensagem)]);

    // Então (Assert)
    expect(resultados.sort()).toEqual(["duplicada", "pendente"]);
    const { rows } = await pool.query("SELECT count(*) FROM staging_telemetria");
    expect(rows[0].count).toBe("1");
  });

  it("deve aceitar a leitura quando antes houve recusas da mesma estação e horário", async () => {
    // Dado (Arrange)
    await cadastrarEstacao(pool, estacaoId, "Inativa");
    await gravarEVerificar(mensagem);
    await gravarEVerificar(mensagem);
    await cadastrarEstacao(pool, estacaoId, "Ativa");

    // Quando (Act)
    const primeira = await gravarEVerificar(mensagem);
    const segunda = await gravarEVerificar(mensagem);

    // Então (Assert)
    expect([primeira, segunda]).toEqual(["pendente", "duplicada"]);
    const { rows } = await pool.query("SELECT count(*) FROM staging_telemetria");
    expect(rows[0].count).toBe("3");
  });

  it("deve continuar acusando duplicata quando o status da original muda", async () => {
    // Dado (Arrange)
    await gravarEVerificar(mensagem);
    await pool.query("UPDATE staging_telemetria SET status = 'publicada'");

    // Quando (Act)
    const resultado = await gravarEVerificar(mensagem);

    // Então (Assert)
    expect(resultado).toBe("duplicada");
  });
});
