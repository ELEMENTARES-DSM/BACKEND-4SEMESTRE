import net from "net";
import { randomUUID } from "node:crypto";
import mqtt from "mqtt";
import { createBroker } from "aedes";
import { pool } from "../../config/db";
import { ConsumidorMqttTelemetria } from "../../events/consumers/mqtt-telemetria.consumer";
import { RabbitMqTelemetriaPublisher } from "../../events/publishers/rabbitmq-telemetria.publisher";
import { encaminharParaIngestao } from "../../services/processar-mensagem.service";
import { configurarPublisherStaging } from "../../services/staging-publisher.service";
import { ReceivedMetricsService } from "../../services/received-metrics.service";
import { duplicateMetricsService } from "../../services/duplicate-metrics.service";
import { rejectionMetricsService } from "../../services/rejection-metrics.service";
import { logger } from "../../utils/logger";
import { cadastrarEstacao, criarTabelaEstacoes } from "./helpers/estacoes";

// TASK 11.05: mensagem publicada no MQTT percorre o fluxo inteiro da ingestão
// (validação, estação, duplicata, staging e último sinal) com PostgreSQL real.
// O broker é o aedes em memória; a publicação no RabbitMQ é só observada.
const integration = process.env.STAGING_TEST_DATABASE_URL ? describe : describe.skip;

const topicoDe = (uuid: string) => `pulso/estacoes/${uuid}/telemetria`;

async function esperar(condicao: () => Promise<boolean>, limiteMs = 10000): Promise<void> {
  const inicio = Date.now();
  while (!(await condicao())) {
    if (Date.now() - inicio > limiteMs) {
      throw new Error("tempo esgotado esperando a condição");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

integration("fluxo MQTT -> staging (TASK 11.05)", () => {
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
    const { rows } = await pool.query(
      "SELECT ultimo_ping, nivel_bateria FROM estacoes WHERE id = $1",
      [estacaoId],
    );
    return rows[0];
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

    jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    jest.spyOn(logger, "info").mockImplementation(() => undefined);
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);

    configurarPublisherStaging({ processarPendentes } as unknown as RabbitMqTelemetriaPublisher);

    await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
    const { port } = servidor.address() as net.AddressInfo;

    const assinou = new Promise<void>((resolve) => {
      broker.on("subscribe", (_subs, cliente) => {
        if (cliente?.id === "ingestao-dados") resolve();
      });
    });
    consumidor = new ConsumidorMqttTelemetria({
      config: {
        brokerUrl: `mqtt://127.0.0.1:${port}`,
        usuario: "ingestao-dados",
        senha: "teste",
        qos: 1,
      },
      proximoPasso: encaminharParaIngestao,
      metricasRecebidas: recebidas,
    });
    consumidor.iniciar();
    await assinou;

    estacao = await mqtt.connectAsync(`mqtt://127.0.0.1:${port}`, {
      clientId: `estacao-${randomUUID()}`,
    });
  });

  afterAll(async () => {
    try {
      await consumidor.encerrar();
      await new Promise<void>((resolve) => estacao.end(true, {}, () => resolve()));
      await new Promise<void>((resolve) => broker.close(() => servidor.close(() => resolve())));
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await pool.end();
      jest.restoreAllMocks();
    }
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE staging_telemetria, estacoes");
    recebidas.reset();
    duplicateMetricsService.reset();
    rejectionMetricsService.reset();
    processarPendentes.mockClear();
  });

  it("leitura válida fica recebida no staging, atualiza o último sinal e segue para a publicação", async () => {
    const estacaoId = randomUUID();
    await cadastrarEstacao(pool, estacaoId, "Com Falha");

    await estacao.publishAsync(
      topicoDe(estacaoId),
      payload("2026-10-20T12:00:00Z", ',"nivel_bateria":87'),
      { qos: 1 },
    );
    await esperar(async () => recebidas.obterTotal() === 1);

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

  it("payload inválido fica rejeitado no staging e soma em leiturasRejeitadas", async () => {
    const estacaoId = randomUUID();
    await cadastrarEstacao(pool, estacaoId);

    await estacao.publishAsync(topicoDe(estacaoId), "texto solto", { qos: 1 });
    await esperar(async () => recebidas.obterTotal() === 1);

    const linhas = await linhasStaging(estacaoId);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      status: "rejeitada",
      motivo_rejeicao: "Payload malformado",
      payload_bruto: "texto solto",
    });
    expect(rejectionMetricsService.obterMetricas()).toEqual({ "Payload malformado": 1 });
    expect((await sinalEstacao(estacaoId)).ultimo_ping).toBeNull();
    expect(processarPendentes).not.toHaveBeenCalled();
  });

  it("mensagem repetida soma em duplicadasIgnoradas e não grava de novo", async () => {
    const estacaoId = randomUUID();
    await cadastrarEstacao(pool, estacaoId);
    const mensagem = payload("2026-10-20T12:05:00Z");

    await estacao.publishAsync(topicoDe(estacaoId), mensagem, { qos: 1 });
    await estacao.publishAsync(topicoDe(estacaoId), mensagem, { qos: 1 });
    await esperar(async () => recebidas.obterTotal() === 2);

    expect(await linhasStaging(estacaoId)).toHaveLength(1);
    expect(duplicateMetricsService.obterTotal()).toBe(1);
    expect(rejectionMetricsService.obterMetricas()).toEqual({});
  });

  it("estação desconhecida e estação inativa ficam rejeitadas com o motivo da US-12", async () => {
    const desconhecida = randomUUID();
    const inativa = randomUUID();
    await cadastrarEstacao(pool, inativa, "Inativa");

    await estacao.publishAsync(topicoDe(desconhecida), payload("2026-10-20T12:10:00Z"), { qos: 1 });
    await estacao.publishAsync(topicoDe(inativa), payload("2026-10-20T12:10:00Z"), { qos: 1 });
    await esperar(async () => recebidas.obterTotal() === 2);

    expect(await linhasStaging(desconhecida)).toEqual([
      expect.objectContaining({ status: "rejeitada", motivo_rejeicao: "Estação desconhecida" }),
    ]);
    expect(await linhasStaging(inativa)).toEqual([
      expect.objectContaining({ status: "rejeitada", motivo_rejeicao: "Estação inativa" }),
    ]);
    expect((await sinalEstacao(inativa)).ultimo_ping).toBeNull();
    expect(rejectionMetricsService.obterMetricas()).toEqual({
      "Estação desconhecida": 1,
      "Estação inativa": 1,
    });
  });

  it("leiturasRecebidas soma 1 por mensagem entregue, aceita, rejeitada ou duplicata", async () => {
    const estacaoId = randomUUID();
    await cadastrarEstacao(pool, estacaoId);
    const valida = payload("2026-10-20T12:15:00Z");

    await estacao.publishAsync(topicoDe(estacaoId), valida, { qos: 1 });
    await estacao.publishAsync(topicoDe(estacaoId), "{}", { qos: 1 });
    await estacao.publishAsync(topicoDe(estacaoId), valida, { qos: 1 });
    await esperar(async () => recebidas.obterTotal() === 3);

    expect(await linhasStaging(estacaoId)).toHaveLength(2);
  });
});
