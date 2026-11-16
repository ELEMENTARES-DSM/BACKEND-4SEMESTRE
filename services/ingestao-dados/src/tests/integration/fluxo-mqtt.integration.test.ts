import net from "net";
import { randomUUID } from "node:crypto";
import mqtt from "mqtt";
import { createBroker } from "aedes";
import { pool } from "../../config/db";
import { encerrarValkey, valkey } from "../../config/valkey";
import { ConsumidorMqttTelemetria } from "../../events/consumers/mqtt-telemetria.consumer";
import { RabbitMqTelemetriaPublisher } from "../../events/publishers/rabbitmq-telemetria.publisher";
import { LISTA_PENDENTES, LISTA_RECEBIDAS } from "../../repositories/staging-valkey.repository";
import {
  encerrarVerificacao,
  iniciarVerificacao,
  receberMensagem,
} from "../../services/processar-mensagem.service";
import { configurarPublisherStaging } from "../../services/staging-publisher.service";
import { ReceivedMetricsService } from "../../services/received-metrics.service";
import { duplicateMetricsService } from "../../services/duplicate-metrics.service";
import { rejectionMetricsService } from "../../services/rejection-metrics.service";
import { gravacaoMetricsService } from "../../services/gravacao-metrics.service";
import { logger } from "../../utils/logger";
import { cadastrarEstacao, criarTabelaEstacoes } from "./helpers/estacoes";
import { esperar, usarValkeyDeTeste } from "./helpers/valkey";

// TASK 11.05: mensagem publicada no MQTT percorre o fluxo inteiro da ingestão
// (Valkey, validação, estação, duplicata, staging_telemetria e último sinal)
// com Valkey e PostgreSQL de teste. O broker é o aedes em memória, isolado por
// arquivo; a publicação no RabbitMQ é só observada.
const integration =
  process.env.STAGING_TEST_DATABASE_URL && process.env.VALKEY_TEST_URL ? describe : describe.skip;

const topicoDe = (uuid: string) => `pulso/estacoes/${uuid}/telemetria`;

integration("TASK 11.05 · fluxo MQTT → Valkey → verificação", () => {
  const schema = `fluxo_mqtt_test_${randomUUID().replaceAll("-", "")}`;
  const broker = createBroker();
  const servidor = net.createServer(broker.handle);
  const recebidas = new ReceivedMetricsService();
  const processarPendentes = jest.fn(async () => undefined);
  let consumidor: ConsumidorMqttTelemetria;
  let estacao: mqtt.MqttClient;

  const payload = (timestamp: string, extras = "") =>
    `{"timestamp":"${timestamp}"${extras},"leituras":[{"sensor":"T-01","valor":25.4}]}`;

  const linhasStaging = async (estacaoId: string) => {
    const { rows } = await pool.query(
      "SELECT * FROM staging_telemetria WHERE estacao_uuid = $1 ORDER BY criado_em",
      [estacaoId],
    );
    return rows;
  };

  const sinalEstacao = async (estacaoId: string) => {
    const { rows } = await pool.query("SELECT ultimo_ping, nivel_bateria FROM estacoes WHERE id = $1", [estacaoId]);
    return rows[0];
  };

  // Gravadas no Valkey e já verificadas (a fila de verificação esvaziou).
  const esperarVerificadas = async (total: number) => {
    await esperar(async () => recebidas.obterTotal() === total);
    await esperar(async () => (await valkey().lLen(LISTA_RECEBIDAS)) === 0);
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
    await usarValkeyDeTeste(3);

    configurarPublisherStaging({ processarPendentes } as unknown as RabbitMqTelemetriaPublisher);
    iniciarVerificacao(300);

    await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
    const { port } = servidor.address() as net.AddressInfo;
    const assinou = new Promise<void>((resolve) => {
      broker.on("subscribe", (_subs, cliente) => {
        if (cliente?.id === "ingestao-dados") resolve();
      });
    });
    consumidor = new ConsumidorMqttTelemetria({
      // US-29: sem usuário e senha, como o Mosquitto do compose.
      config: { brokerUrl: `mqtt://127.0.0.1:${port}`, qos: 1 },
      proximoPasso: receberMensagem,
      metricasRecebidas: recebidas,
      reentregaMs: 300,
    });
    consumidor.iniciar();
    await assinou;
    estacao = await mqtt.connectAsync(`mqtt://127.0.0.1:${port}`, { clientId: `estacao-${randomUUID()}` });
  });

  afterAll(async () => {
    try {
      encerrarVerificacao();
      await consumidor.encerrar();
      await new Promise<void>((resolve) => estacao.end(true, {}, () => resolve()));
      await new Promise<void>((resolve) => broker.close(() => servidor.close(() => resolve())));
      await valkey().flushDb();
      await encerrarValkey();
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await pool.end();
    }
  });

  beforeEach(async () => {
    jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    jest.spyOn(logger, "info").mockImplementation(() => undefined);
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    processarPendentes.mockResolvedValue(undefined);
    await pool.query("TRUNCATE staging_telemetria, estacoes");
    // O publicador é falso aqui: as pendentes de um teste não podem contar no seguinte.
    await valkey().del(LISTA_PENDENTES);
    recebidas.reset();
    duplicateMetricsService.reset();
    rejectionMetricsService.reset();
    gravacaoMetricsService.reset();
  });

  it("deve gravar recebida na staging_telemetria, atualizar o último sinal e pedir a publicação quando a leitura é válida", async () => {
    // Dado (Arrange)
    const estacaoId = randomUUID();
    await cadastrarEstacao(pool, estacaoId, "Com Falha");

    // Quando (Act)
    await estacao.publishAsync(topicoDe(estacaoId), payload("2026-10-20T12:00:00Z", ',"nivel_bateria":87'), { qos: 1 });
    await esperarVerificadas(1);

    // Então (Assert)
    const linhas = await linhasStaging(estacaoId);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      status: "recebida",
      unixtime: String(Date.parse("2026-10-20T12:00:00Z") / 1000),
      motivo_rejeicao: null,
    });
    const sinal = await sinalEstacao(estacaoId);
    expect(sinal.nivel_bateria).toBe(87);
    expect(sinal.ultimo_ping.toISOString()).toBe(linhas[0].criado_em.toISOString());
    expect(processarPendentes).toHaveBeenCalledTimes(1);
  });

  it("deve gravar rejeitada e somar em leiturasRejeitadas quando o payload é inválido", async () => {
    // Dado (Arrange)
    const estacaoId = randomUUID();
    await cadastrarEstacao(pool, estacaoId);

    // Quando (Act)
    await estacao.publishAsync(topicoDe(estacaoId), "texto solto", { qos: 1 });
    await esperarVerificadas(1);

    // Então (Assert)
    const linhas = await linhasStaging(estacaoId);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ status: "rejeitada", motivo_rejeicao: "Payload malformado", payload_bruto: "texto solto" });
    expect(rejectionMetricsService.obterMetricas()).toEqual({ "Payload malformado": 1 });
    expect((await sinalEstacao(estacaoId)).ultimo_ping).toBeNull();
    expect(processarPendentes).not.toHaveBeenCalled();
  });

  it("deve somar em duplicadasIgnoradas e não gravar de novo quando a mensagem se repete", async () => {
    // Dado (Arrange)
    const estacaoId = randomUUID();
    await cadastrarEstacao(pool, estacaoId);
    const mensagem = payload("2026-10-20T12:05:00Z");

    // Quando (Act)
    await estacao.publishAsync(topicoDe(estacaoId), mensagem, { qos: 1 });
    await estacao.publishAsync(topicoDe(estacaoId), mensagem, { qos: 1 });
    await esperarVerificadas(2);

    // Então (Assert)
    expect(await linhasStaging(estacaoId)).toHaveLength(1);
    expect(duplicateMetricsService.obterTotal()).toBe(1);
    expect(rejectionMetricsService.obterMetricas()).toEqual({});
  });

  it("deve gravar rejeitada com o motivo da US-12 quando a estação é desconhecida ou inativa", async () => {
    // Dado (Arrange)
    const desconhecida = randomUUID();
    const inativa = randomUUID();
    await cadastrarEstacao(pool, inativa, "Inativa");

    // Quando (Act)
    await estacao.publishAsync(topicoDe(desconhecida), payload("2026-10-20T12:10:00Z"), { qos: 1 });
    await estacao.publishAsync(topicoDe(inativa), payload("2026-10-20T12:10:00Z"), { qos: 1 });
    await esperarVerificadas(2);

    // Então (Assert)
    expect(await linhasStaging(desconhecida)).toEqual([
      expect.objectContaining({ status: "rejeitada", motivo_rejeicao: "Estação desconhecida" }),
    ]);
    expect(await linhasStaging(inativa)).toEqual([
      expect.objectContaining({ status: "rejeitada", motivo_rejeicao: "Estação inativa" }),
    ]);
    expect((await sinalEstacao(inativa)).ultimo_ping).toBeNull();
    expect(rejectionMetricsService.obterMetricas()).toEqual({ "Estação desconhecida": 1, "Estação inativa": 1 });
  });

  it("deve somar 1 em leiturasRecebidas por mensagem gravada quando ela é aceita, recusada ou duplicada", async () => {
    // Dado (Arrange)
    const estacaoId = randomUUID();
    await cadastrarEstacao(pool, estacaoId);
    const valida = payload("2026-10-20T12:15:00Z");

    // Quando (Act)
    await estacao.publishAsync(topicoDe(estacaoId), valida, { qos: 1 });
    await estacao.publishAsync(topicoDe(estacaoId), "{}", { qos: 1 });
    await estacao.publishAsync(topicoDe(estacaoId), valida, { qos: 1 });
    await esperarVerificadas(3);

    // Então (Assert)
    expect(await linhasStaging(estacaoId)).toHaveLength(2);
  });

  it("deve seguir para a publicação, registrando no log e sem mexer no último sinal, quando a staging_telemetria está fora", async () => {
    // Dado (Arrange)
    const estacaoId = randomUUID();
    await cadastrarEstacao(pool, estacaoId);
    const erroLog = jest.spyOn(logger, "error").mockImplementation(() => undefined);
    // Tira a staging_telemetria do ar renomeando a tabela: toda gravação nela falha.
    await pool.query("ALTER TABLE staging_telemetria RENAME TO staging_telemetria_fora");

    // Quando (Act)
    try {
      await estacao.publishAsync(topicoDe(estacaoId), payload("2026-10-20T12:20:00Z"), { qos: 1 });
      await esperarVerificadas(1);
    } finally {
      await pool.query("ALTER TABLE staging_telemetria_fora RENAME TO staging_telemetria");
    }

    // Então (Assert)
    expect(await valkey().lLen(LISTA_PENDENTES)).toBe(1);
    expect(processarPendentes).toHaveBeenCalledTimes(1);
    expect(erroLog).toHaveBeenCalledWith(
      "PostgreSQL indisponível ao gravar a aceita e o último sinal; a leitura segue pelo Valkey",
      expect.objectContaining({ erro: expect.stringContaining("staging_telemetria") }),
    );
    expect(await linhasStaging(estacaoId)).toHaveLength(0);
    expect((await sinalEstacao(estacaoId)).ultimo_ping).toBeNull();
    expect(gravacaoMetricsService.obterMensagensGravadas()).toBe(1);
  }, 30000);

  it("deve fazer os contadores de gravadas e rejeitadas gravadas baterem com a staging_telemetria", async () => {
    // Dado (Arrange)
    const estacaoId = randomUUID();
    await cadastrarEstacao(pool, estacaoId);
    const valida = payload("2026-10-20T12:25:00Z");

    // Quando (Act)
    await estacao.publishAsync(topicoDe(estacaoId), valida, { qos: 1 });
    await estacao.publishAsync(topicoDe(estacaoId), valida, { qos: 1 });
    await estacao.publishAsync(topicoDe(estacaoId), "texto solto", { qos: 1 });
    await estacao.publishAsync(topicoDe(randomUUID()), payload("2026-10-20T12:25:00Z"), { qos: 1 });
    await esperarVerificadas(4);

    // Então (Assert)
    const { rows } = await pool.query(
      "SELECT status, count(*)::int AS total FROM staging_telemetria GROUP BY status ORDER BY status",
    );
    expect(rows).toEqual([
      { status: "recebida", total: 1 },
      { status: "rejeitada", total: 2 },
    ]);
    expect(gravacaoMetricsService.obterMensagensGravadas()).toBe(1);
    expect(gravacaoMetricsService.obterRejeitadasGravadas()).toBe(2);
    expect(duplicateMetricsService.obterTotal()).toBe(1);
  });
});
