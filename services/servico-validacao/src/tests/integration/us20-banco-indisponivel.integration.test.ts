import { randomUUID } from "node:crypto";
import { describe, it, expect, jest, beforeAll, afterAll, beforeEach, afterEach } from "@jest/globals";
import { Channel, ChannelModel } from "amqplib";
import { Pool } from "pg";
import { pool } from "../../config/db";
import {
  ConsumidorRabbitMqTelemetria,
  FILA_VALIDACAO_TELEMETRIA,
} from "../../events/consumers/rabbitmq-telemetria.consumer";
import { processarEventoTelemetria } from "../../services/processar-telemetria.service";
import { EventoTelemetriaDTO } from "../../dto/evento-telemetria.dto";
import logger from "../../utils/logger";
import {
  cadastrarEstacao,
  cadastrarSensor,
  prepararSchemaValidacao,
} from "./helpers/banco-validacao";
import {
  conectarAdmin,
  contarDlq,
  esperar,
  lerDlq,
  limparFilas,
  publicarEvento,
} from "./helpers/rabbitmq-validacao";
import { ProxyTcp } from "./helpers/proxy-tcp";

// US-20 (TASK 20.01) com PostgreSQL e RabbitMQ reais: o banco "cai" e "volta"
// por um proxy TCP. Execute com VALIDACAO_TEST_DATABASE_URL e RABBITMQ_TEST_URL.
const databaseUrl = process.env.VALIDACAO_TEST_DATABASE_URL;
const rabbitUrl = process.env.RABBITMQ_TEST_URL;
const integration = databaseUrl && rabbitUrl ? describe : describe.skip;

integration("US-20 - banco indisponível no consumo (PostgreSQL e RabbitMQ)", () => {
  const schema = `validacao_us20_${randomUUID().replaceAll("-", "")}`;
  let admin: { connection: ChannelModel; channel: Channel };
  let proxy: ProxyTcp;
  let poolViaProxy: Pool;
  let consumidor: ConsumidorRabbitMqTelemetria | undefined;
  let estacao: string;

  const contarMedidas = async (): Promise<number> => {
    const { rows } = await pool.query("SELECT count(*)::int AS total FROM medidas");
    return rows[0].total;
  };

  const contarFila = async (): Promise<number> =>
    (await admin.channel.checkQueue(FILA_VALIDACAO_TELEMETRIA)).messageCount;

  const evento = (unixtime: number, valor = 20): EventoTelemetriaDTO => ({
    staging_id: randomUUID(),
    estacao_uuid: estacao,
    unixtime,
    leituras: [{ sensor: "T-01", valor }],
  });

  const iniciarConsumidor = async (
    processar: (e: EventoTelemetriaDTO) => Promise<unknown> = (e) =>
      processarEventoTelemetria(e, { dbPool: poolViaProxy }),
  ) => {
    consumidor = new ConsumidorRabbitMqTelemetria({
      url: rabbitUrl as string,
      reconectarMs: 200,
      esperaBancoMs: 300,
      processarEvento: processar,
      verificarBanco: async () => {
        try {
          await poolViaProxy.query("SELECT 1");
          return true;
        } catch {
          return false;
        }
      },
    });
    await consumidor.iniciar();
    await esperar(async () => consumidor?.estaSaudavel() === true, "consumidor conectado");
  };

  beforeAll(async () => {
    jest.spyOn(logger, "info").mockImplementation(() => undefined);
    jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    jest.spyOn(logger, "error").mockImplementation(() => undefined);
    await prepararSchemaValidacao(pool, schema);
    admin = await conectarAdmin(rabbitUrl as string);

    const destino = new URL(databaseUrl as string);
    proxy = new ProxyTcp(destino.hostname, Number(destino.port || 5432));
    const porta = await proxy.ligar();
    destino.hostname = "127.0.0.1";
    destino.port = String(porta);
    poolViaProxy = new Pool({
      connectionString: destino.toString(),
      options: `-c search_path=${schema}`,
      connectionTimeoutMillis: 1000,
    });
    // Conexões ociosas cortadas pelo proxy não podem derrubar o processo de teste.
    poolViaProxy.on("error", () => undefined);
  });

  afterAll(async () => {
    try {
      await limparFilas(admin.channel);
      await admin.connection.close();
      await poolViaProxy.end();
      await proxy.derrubar();
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await pool.end();
      jest.restoreAllMocks();
    }
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE medidas, sensores, estacoes CASCADE");
    await limparFilas(admin.channel);
    estacao = randomUUID();
    await cadastrarEstacao(pool, estacao);
    await cadastrarSensor(pool, { estacaoId: estacao, codigo: "T-01" });
  });

  afterEach(async () => {
    await consumidor?.encerrar();
    consumidor = undefined;
    await proxy.ligar().catch(() => undefined);
  });

  it("eventos que chegam com o banco fora esperam na fila e são todos gravados quando ele volta, sem ir para a DLQ", async () => {
    await iniciarConsumidor();
    await proxy.derrubar();

    for (let i = 0; i < 30; i++) publicarEvento(admin.channel, evento(1792400000 + i * 300));
    await esperar(async () => consumidor?.estaComConsumoPausado() === true, "consumo pausado");
    // Várias conferências do banco com o consumo pausado: nada é entregue nesse tempo.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await esperar(async () => (await contarFila()) === 30, "eventos de volta na fila");
    expect(await contarMedidas()).toBe(0);

    await proxy.ligar();
    await esperar(async () => (await contarMedidas()) === 30, "30 medidas gravadas", 20000);
    await esperar(async () => (await contarFila()) === 0, "fila vazia");

    expect(await contarDlq(admin.channel)).toBe(0);
    expect(consumidor?.estaComConsumoPausado()).toBe(false);
  }, 40000);

  it("eventos em processamento quando o banco cai não são confirmados e voltam inteiros para a fila", async () => {
    let emProcessamento = 0;
    let liberar: () => void = () => undefined;
    const portao = new Promise<void>((resolve) => {
      liberar = resolve;
    });
    await iniciarConsumidor(async (e) => {
      emProcessamento += 1;
      await portao;
      return processarEventoTelemetria(e, { dbPool: poolViaProxy });
    });

    for (let i = 0; i < 10; i++) publicarEvento(admin.channel, evento(1792500000 + i * 300));
    await esperar(async () => emProcessamento === 10, "10 eventos em processamento");

    await proxy.derrubar();
    liberar();
    await esperar(async () => consumidor?.estaComConsumoPausado() === true, "consumo pausado");
    await esperar(async () => (await contarFila()) === 10, "os 10 de volta na fila");
    expect(await contarMedidas()).toBe(0);

    await proxy.ligar();
    await esperar(async () => (await contarMedidas()) === 10, "10 medidas gravadas", 20000);
    expect(await contarDlq(admin.channel)).toBe(0);
  }, 40000);

  it("erro do próprio evento com o banco no ar volta para a fila e, no limite de 3 entregas, o RabbitMQ manda para a DLQ", async () => {
    await iniciarConsumidor();

    // valor_bruto é NUMERIC(18,6): 10^13 estoura a coluna e o evento falha sozinho.
    const problematico = evento(1792600000, 1e13);
    publicarEvento(admin.channel, problematico);
    publicarEvento(admin.channel, evento(1792600300));
    await esperar(async () => (await contarDlq(admin.channel)) === 1, "evento no limite de entregas", 20000);

    expect(consumidor?.estaComConsumoPausado()).toBe(false);
    expect(await contarMedidas()).toBe(1);
    const [morto] = await lerDlq(admin.channel);
    // Chega como estava, sem motivo: quem o mandou foi o limite de entregas.
    expect(morto.corpo).toEqual(problematico);
  }, 40000);
});
