import { randomUUID } from "node:crypto";
import { describe, it, expect, jest, beforeAll, afterAll, beforeEach } from "@jest/globals";
import { Channel, ChannelModel } from "amqplib";
import { pool } from "../../config/db";
import { ConsumidorRabbitMqTelemetria } from "../../events/consumers/rabbitmq-telemetria.consumer";
import {
  RabbitMqIndisponivelError,
  reenviarEventosDlq,
} from "../../services/reenvio-dlq.service";
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
  FILA_VALIDACAO_DLQ,
  lerDlq,
  limparFilas,
  publicarEvento,
} from "./helpers/rabbitmq-validacao";

// TASK 20.03 com PostgreSQL, RabbitMQ e o consumidor reais. Execute com
// VALIDACAO_TEST_DATABASE_URL e RABBITMQ_TEST_URL apontando para instâncias de teste.
const databaseUrl = process.env.VALIDACAO_TEST_DATABASE_URL;
const rabbitUrl = process.env.RABBITMQ_TEST_URL;
const integration = databaseUrl && rabbitUrl ? describe : describe.skip;

integration("US-20 - reenvio de eventos da DLQ (PostgreSQL e RabbitMQ)", () => {
  const schema = `validacao_reenvio_${randomUUID().replaceAll("-", "")}`;
  let admin: { connection: ChannelModel; channel: Channel };
  let consumidor: ConsumidorRabbitMqTelemetria;
  let estacao: string;

  const reenviar = (quantidade?: number) =>
    reenviarEventosDlq(quantidade, { url: rabbitUrl as string });

  const contarMedidas = async (): Promise<number> => {
    const { rows } = await pool.query("SELECT count(*)::int AS total FROM medidas");
    return rows[0].total;
  };

  const evento = (unixtime: number, sensor = "T-01", valor = 20) => ({
    staging_id: randomUUID(),
    estacao_uuid: estacao,
    unixtime,
    leituras: [{ sensor, valor }],
  });

  // Coloca o evento direto na DLQ, como o RabbitMQ faz no limite de entregas.
  const colocarNaDlq = (corpo: unknown) => {
    admin.channel.sendToQueue(FILA_VALIDACAO_DLQ, Buffer.from(JSON.stringify(corpo)), { persistent: true });
  };

  beforeAll(async () => {
    jest.spyOn(logger, "info").mockImplementation(() => undefined);
    jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    jest.spyOn(logger, "error").mockImplementation(() => undefined);
    await prepararSchemaValidacao(pool, schema);
    admin = await conectarAdmin(rabbitUrl as string);
    await limparFilas(admin.channel);

    consumidor = new ConsumidorRabbitMqTelemetria({ url: rabbitUrl as string, reconectarMs: 200 });
    await consumidor.iniciar();
    await esperar(async () => consumidor.estaSaudavel(), "consumidor conectado");
  });

  afterAll(async () => {
    try {
      await consumidor.encerrar();
      await limparFilas(admin.channel);
      await admin.connection.close();
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await pool.end();
      jest.restoreAllMocks();
    }
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE medidas, sensores, estacoes");
    await limparFilas(admin.channel);
    estacao = randomUUID();
    await cadastrarEstacao(pool, estacao);
    await cadastrarSensor(pool, { estacaoId: estacao, codigo: "T-01" });
  });

  it("DLQ vazia: reenviados 0 e restantes 0", async () => {
    await expect(reenviar()).resolves.toEqual({ reenviados: 0, restantes: 0 });
  });

  it("30 na DLQ: quantidade 10 reenvia os 10 mais antigos e deixa 20; sem quantidade reenvia o resto", async () => {
    for (let i = 0; i < 30; i++) colocarNaDlq(evento(1792400000 + i * 300));
    await esperar(async () => (await contarDlq(admin.channel)) === 30, "30 eventos na DLQ");

    await expect(reenviar(10)).resolves.toEqual({ reenviados: 10, restantes: 20 });
    await esperar(async () => (await contarMedidas()) === 10, "10 medidas");
    const { rows } = await pool.query("SELECT min(unixtime)::bigint AS menor, max(unixtime)::bigint AS maior FROM medidas");
    expect([Number(rows[0].menor), Number(rows[0].maior)]).toEqual([1792400000, 1792400000 + 9 * 300]);

    await expect(reenviar()).resolves.toEqual({ reenviados: 20, restantes: 0 });
    await esperar(async () => (await contarMedidas()) === 30, "30 medidas");
  });

  it("sensor cadastrado depois: a leitura recusada vira medida e sai da DLQ", async () => {
    publicarEvento(admin.channel, evento(1792500000, "X-99", 7.5));
    await esperar(async () => (await contarDlq(admin.channel)) === 1, "leitura recusada na DLQ");

    await cadastrarSensor(pool, { estacaoId: estacao, codigo: "X-99" });
    await expect(reenviar()).resolves.toEqual({ reenviados: 1, restantes: 0 });
    await esperar(async () => (await contarMedidas()) === 1, "medida de X-99");

    expect(await contarDlq(admin.channel)).toBe(0);
  });

  it("causa não corrigida: a leitura volta para a DLQ e não é reenviada de novo na mesma chamada", async () => {
    publicarEvento(admin.channel, evento(1792500000, "X-99", 7.5));
    await esperar(async () => (await contarDlq(admin.channel)) === 1, "leitura recusada na DLQ");

    const resultado = await reenviar();

    expect(resultado.reenviados).toBe(1);
    await esperar(async () => (await contarDlq(admin.channel)) === 1, "leitura de volta na DLQ");
    const [deVolta] = await lerDlq(admin.channel);
    expect(deVolta.corpo).toMatchObject({ motivo: "Sensor inexistente na estação" });
  });

  it("reenviar nunca duplica medida", async () => {
    const original = evento(1792600000);
    publicarEvento(admin.channel, original);
    await esperar(async () => (await contarMedidas()) === 1, "medida original");

    colocarNaDlq(original);
    await expect(reenviar()).resolves.toEqual({ reenviados: 1, restantes: 0 });
    await esperar(async () => {
      const { messageCount } = await admin.channel.checkQueue("validacao.telemetria");
      return messageCount === 0;
    }, "evento reenviado consumido");
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(await contarMedidas()).toBe(1);
    expect(await contarDlq(admin.channel)).toBe(0);
  });

  it("os dois formatos da DLQ voltam ao normal e são processados", async () => {
    colocarNaDlq(evento(1792700000));
    colocarNaDlq({
      ...evento(1792700300),
      motivo: "Sensor inexistente na estação",
      recusado_em: "2026-10-20T14:05:08.000Z",
    });
    await esperar(async () => (await contarDlq(admin.channel)) === 2, "dois eventos na DLQ");

    await expect(reenviar()).resolves.toEqual({ reenviados: 2, restantes: 0 });
    await esperar(async () => (await contarMedidas()) === 2, "duas medidas");
  });

  it("RabbitMQ indisponível: falha com RabbitMqIndisponivelError e a DLQ fica como estava", async () => {
    colocarNaDlq(evento(1792800000));
    await esperar(async () => (await contarDlq(admin.channel)) === 1, "evento na DLQ");

    await expect(
      reenviarEventosDlq(undefined, { url: "amqp://guest:guest@127.0.0.1:1" }),
    ).rejects.toBeInstanceOf(RabbitMqIndisponivelError);
    expect(await contarDlq(admin.channel)).toBe(1);
  });
});
