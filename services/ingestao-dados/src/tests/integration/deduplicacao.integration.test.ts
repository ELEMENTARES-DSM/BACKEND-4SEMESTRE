import { randomUUID } from "node:crypto";
import { pool } from "../../config/db";
import { encerrarValkey, valkey } from "../../config/valkey";
import { MensagemBruta } from "../../dto/mensagem-ingestao.dto";
import { chaveMensagem, gravarBruta, lerMensagem } from "../../repositories/staging-valkey.repository";
import { verificarMensagem } from "../../services/processar-mensagem.service";
import { duplicateMetricsService } from "../../services/duplicate-metrics.service";
import { rejectionMetricsService } from "../../services/rejection-metrics.service";
import { logger } from "../../utils/logger";
import { cadastrarEstacao, criarTabelaEstacoes } from "./helpers/estacoes";
import { gravarEVerificar, usarValkeyDeTeste } from "./helpers/valkey";

// Critérios da TASK 13.01 (duplicata por estação e timestamp), que até a 40.04
// continua sendo o índice único da staging_telemetria. Integração com
// PostgreSQL e Valkey de teste; cada execução usa um schema isolado.
const integration =
  process.env.STAGING_TEST_DATABASE_URL && process.env.VALKEY_TEST_URL ? describe : describe.skip;

integration("TASK 13.01 · duplicata pelo índice da staging_telemetria", () => {
  const schema = `dedup_test_${randomUUID().replaceAll("-", "")}`;

  const mensagem = (
    estacaoId: string,
    timestamp: string,
    extras: Partial<MensagemBruta> = {},
  ): MensagemBruta => ({
    topico: `pulso/estacoes/${estacaoId}/telemetria`,
    recebidoEm: "2026-10-15T00:00:05Z",
    payloadBruto: `{ "timestamp":"${timestamp}", "leituras":[{"sensor":"temperatura","valor":25}] }`,
    ...extras,
  });

  const novaEstacao = async (): Promise<string> => {
    const id = randomUUID();
    await cadastrarEstacao(pool, id);
    return id;
  };

  const contarLinhas = async (): Promise<string> => {
    const { rows } = await pool.query("SELECT count(*) FROM staging_telemetria");
    return rows[0].count;
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
    await usarValkeyDeTeste(2);
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
    duplicateMetricsService.reset();
    rejectionMetricsService.reset();
  });

  it("deve marcar a segunda como duplicada sem alterar a original quando a estação e o timestamp se repetem", async () => {
    // Dado (Arrange)
    const estacaoId = await novaEstacao();
    const original = mensagem(estacaoId, "2026-10-15T00:00:00Z");
    // Reenvio com outro horário de recebimento e outro espaçamento, mesmo timestamp.
    const reenvio = mensagem(estacaoId, "2026-10-15T00:00:00Z", {
      recebidoEm: "2026-10-15T00:00:30Z",
      payloadBruto: '{"timestamp":"2026-10-15T00:00:00Z","leituras":[{"sensor":"temperatura","valor":25}]}',
    });
    expect(await gravarEVerificar(original)).toBe("pendente");
    const { rows: antes } = await pool.query("SELECT status, criado_em, payload_bruto FROM staging_telemetria");

    // Quando (Act)
    const resultado = await gravarEVerificar(reenvio);

    // Então (Assert)
    expect(resultado).toBe("duplicada");
    const { rows: depois } = await pool.query("SELECT status, criado_em, payload_bruto FROM staging_telemetria");
    expect(depois).toHaveLength(1);
    expect(depois[0]).toEqual(antes[0]);
    expect(depois[0]).toMatchObject({ status: "recebida", payload_bruto: original.payloadBruto });
    expect(depois[0].criado_em.toISOString()).toBe("2026-10-15T00:00:05.000Z");
    expect(duplicateMetricsService.obterTotal()).toBe(1);
    expect(rejectionMetricsService.obterMetricas()).toEqual({});
  });

  it("deve marcar duplicada no Valkey, sem motivo, quando a leitura se repete", async () => {
    // Dado (Arrange)
    const estacaoId = await novaEstacao();
    await gravarEVerificar(mensagem(estacaoId, "2026-10-15T00:00:00Z"));
    const id = await gravarBruta(mensagem(estacaoId, "2026-10-15T00:00:00Z"));

    // Quando (Act)
    await verificarMensagem((await lerMensagem(id))!);

    // Então (Assert)
    const campos = await valkey().hGetAll(chaveMensagem(id));
    expect(campos.status).toBe("duplicada");
    expect(campos.motivo).toBeUndefined();
  });

  it("deve tratar como duplicata quando o mesmo instante vem com fuso diferente", async () => {
    // Dado (Arrange)
    const estacaoId = await novaEstacao();
    await gravarEVerificar(mensagem(estacaoId, "2026-10-14T21:00:00-03:00"));

    // Quando (Act)
    const resultado = await gravarEVerificar(mensagem(estacaoId, "2026-10-15T00:00:00Z"));

    // Então (Assert)
    expect(resultado).toBe("duplicada");
    expect(await contarLinhas()).toBe("1");
  });

  it("deve aceitar as duas quando a mesma estação envia horários diferentes", async () => {
    // Dado (Arrange)
    const estacaoId = await novaEstacao();

    // Quando (Act)
    const primeira = await gravarEVerificar(mensagem(estacaoId, "2026-10-15T00:00:00Z"));
    const segunda = await gravarEVerificar(mensagem(estacaoId, "2026-10-15T00:00:01Z"));

    // Então (Assert)
    expect([primeira, segunda]).toEqual(["pendente", "pendente"]);
    expect(await contarLinhas()).toBe("2");
  });

  it("deve aceitar as duas quando estações diferentes enviam o mesmo horário", async () => {
    // Dado (Arrange)
    const a = await novaEstacao();
    const b = await novaEstacao();

    // Quando (Act)
    const primeira = await gravarEVerificar(mensagem(a, "2026-10-15T00:00:00Z"));
    const segunda = await gravarEVerificar(mensagem(b, "2026-10-15T00:00:00Z"));

    // Então (Assert)
    expect([primeira, segunda]).toEqual(["pendente", "pendente"]);
    expect(await contarLinhas()).toBe("2");
  });

  it("deve aceitar só uma quando chegam 10 cópias idênticas ao mesmo tempo", async () => {
    // Dado (Arrange)
    const copia = mensagem(await novaEstacao(), "2026-10-15T00:00:00Z");

    // Quando (Act)
    const resultados = await Promise.all(Array.from({ length: 10 }, () => gravarEVerificar(copia)));

    // Então (Assert)
    expect(resultados.filter((r) => r === "pendente")).toHaveLength(1);
    expect(resultados.filter((r) => r === "duplicada")).toHaveLength(9);
    expect(await contarLinhas()).toBe("1");
    expect(duplicateMetricsService.obterTotal()).toBe(9);
    expect(rejectionMetricsService.obterMetricas()).toEqual({});
  });

  it("deve tratar como duplicata quando os dois timestamps caem no mesmo segundo", async () => {
    // Dado (Arrange)
    // A chave é o unixtime em segundos (decisão do índice): frações são truncadas.
    const estacaoId = await novaEstacao();
    await gravarEVerificar(mensagem(estacaoId, "2026-10-15T00:00:00.200Z"));

    // Quando (Act)
    const resultado = await gravarEVerificar(mensagem(estacaoId, "2026-10-15T00:00:00.700Z"));

    // Então (Assert)
    expect(resultado).toBe("duplicada");
    expect(await contarLinhas()).toBe("1");
  });

  it("deve aceitar de novo, sem acusar duplicata, quando a mesma mensagem do Valkey é verificada outra vez", async () => {
    // Dado (Arrange)
    // Falha entre a gravação no PostgreSQL e a marcação no Valkey: a mensagem
    // continua "recebida" e volta na rodada seguinte.
    const id = await gravarBruta(mensagem(await novaEstacao(), "2026-10-15T00:00:00Z"));
    const staging = (await lerMensagem(id))!;
    await verificarMensagem(staging);

    // Quando (Act)
    const resultado = await verificarMensagem(staging);

    // Então (Assert)
    expect(resultado).toBe("pendente");
    expect(duplicateMetricsService.obterTotal()).toBe(0);
    expect(await contarLinhas()).toBe("1");
  });
});
