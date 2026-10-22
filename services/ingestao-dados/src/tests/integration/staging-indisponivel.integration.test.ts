import net from "net";
import { randomUUID } from "node:crypto";
import mqtt from "mqtt";
import { createBroker } from "aedes";
import { Pool } from "pg";
import { pool } from "../../config/db";
import { ConsumidorMqttTelemetria } from "../../events/consumers/mqtt-telemetria.consumer";
import { RabbitMqTelemetriaPublisher } from "../../events/publishers/rabbitmq-telemetria.publisher";
import { encaminharParaIngestao } from "../../services/processar-mensagem.service";
import { configurarPublisherStaging } from "../../services/staging-publisher.service";
import { ReceivedMetricsService } from "../../services/received-metrics.service";
import { logger } from "../../utils/logger";
import { cadastrarEstacao, criarTabelaEstacoes } from "./helpers/estacoes";
import { ProxyTcp } from "./helpers/proxy-tcp";

// TASK 14.03 com o banco realmente fora do ar: o serviço fala com o PostgreSQL
// por um proxy TCP, que é derrubado e religado no meio do teste.
const databaseUrl = process.env.STAGING_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

async function esperar(condicao: () => Promise<boolean>, limiteMs = 15000): Promise<void> {
  const inicio = Date.now();
  while (!(await condicao())) {
    if (Date.now() - inicio > limiteMs) {
      throw new Error("tempo esgotado esperando a condição");
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

integration("staging indisponível com a conexão cortada (TASK 14.03)", () => {
  const schema = `staging_fora_test_${randomUUID().replaceAll("-", "")}`;
  const broker = createBroker();
  const servidor = net.createServer(broker.handle);
  const recebidas = new ReceivedMetricsService();
  let proxy: ProxyTcp;
  // Conexão direta, só para preparar o schema e conferir o resultado.
  let banco: Pool;
  let consumidor: ConsumidorMqttTelemetria;
  let estacao: mqtt.MqttClient;

  const linhas = async (estacaoId: string) => {
    const { rows } = await banco.query(
      "SELECT status, criado_em FROM staging_telemetria WHERE estacao_uuid = $1 ORDER BY criado_em",
      [estacaoId],
    );
    return rows;
  };

  const ultimoPing = async (estacaoId: string) => {
    const { rows } = await banco.query("SELECT ultimo_ping FROM estacoes WHERE id = $1", [estacaoId]);
    return rows[0].ultimo_ping as Date | null;
  };

  beforeAll(async () => {
    const destino = new URL(databaseUrl as string);
    proxy = new ProxyTcp(destino.hostname, Number(destino.port || 5432));
    banco = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    await banco.query(`CREATE SCHEMA ${schema}`);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const migration = require("../../db/migrations/1791986171448_create-staging-telemetria.cjs");
    const comandos: string[] = [];
    migration.up({ sql: (sql: string) => comandos.push(sql) });
    for (const sql of comandos) await banco.query(sql);
    await criarTabelaEstacoes(banco);

    const porta = await proxy.ligar();
    const viaProxy = new URL(databaseUrl as string);
    viaProxy.hostname = "127.0.0.1";
    viaProxy.port = String(porta);
    // O módulo db é carregado antes dos hooks: configurar o pool explicitamente.
    pool.options.connectionString = viaProxy.toString();
    pool.options.options = `-c search_path=${schema}`;
    pool.options.connectionTimeoutMillis = 1000;

    jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    jest.spyOn(logger, "info").mockImplementation(() => undefined);
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    configurarPublisherStaging({ processarPendentes: async () => undefined } as unknown as RabbitMqTelemetriaPublisher);

    await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
    const { port } = servidor.address() as net.AddressInfo;
    const assinou = new Promise<void>((resolve) => {
      broker.on("subscribe", (_subs, cliente) => {
        if (cliente?.id === "ingestao-dados") resolve();
      });
    });
    consumidor = new ConsumidorMqttTelemetria({
      config: { brokerUrl: `mqtt://127.0.0.1:${port}`, usuario: "ingestao-dados", senha: "teste", qos: 1 },
      proximoPasso: encaminharParaIngestao,
      metricasRecebidas: recebidas,
      reentregaMs: 300,
    });
    consumidor.iniciar();
    await assinou;
    estacao = await mqtt.connectAsync(`mqtt://127.0.0.1:${port}`, { clientId: `estacao-${randomUUID()}` });
  });

  afterAll(async () => {
    try {
      await consumidor.encerrar();
      await new Promise<void>((resolve) => estacao.end(true, {}, () => resolve()));
      await new Promise<void>((resolve) => broker.close(() => servidor.close(() => resolve())));
      await pool.end();
      await proxy.derrubar();
      await banco.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await banco.end();
      jest.restoreAllMocks();
    }
  });

  it("com o banco fora, o serviço continua no ar, o último sinal não muda e a mensagem é gravada quando ele volta", async () => {
    const estacaoId = randomUUID();
    await cadastrarEstacao(banco, estacaoId);
    const topico = `pulso/estacoes/${estacaoId}/telemetria`;
    const payload = (timestamp: string) =>
      `{"timestamp":"${timestamp}","leituras":[{"sensor":"T-01","valor":25}]}`;
    const erroLog = jest.spyOn(logger, "error").mockImplementation(() => undefined);

    await estacao.publishAsync(topico, payload("2026-10-20T13:00:00Z"), { qos: 1 });
    await esperar(async () => (await linhas(estacaoId)).length === 1);
    const pingAntes = await ultimoPing(estacaoId);

    await proxy.derrubar();
    await estacao.publishAsync(topico, payload("2026-10-20T13:05:00Z"), { qos: 1 });

    // Primeira tentativa e pelo menos uma reentrega, todas registradas em log.
    await esperar(async () =>
      erroLog.mock.calls.filter(([mensagem]) => mensagem === "Falha ao gravar mensagem no staging").length >= 2,
    );
    expect(await linhas(estacaoId)).toHaveLength(1);
    expect(await ultimoPing(estacaoId)).toEqual(pingAntes);
    expect(recebidas.obterTotal()).toBe(1);

    await proxy.ligar();
    await esperar(async () => (await linhas(estacaoId)).length === 2);

    const [, segunda] = await linhas(estacaoId);
    expect(segunda.status).toBe("recebida");
    expect(await ultimoPing(estacaoId)).toEqual(segunda.criado_em);
    expect(recebidas.obterTotal()).toBe(2);
  }, 30000);
});
