import { randomUUID } from "node:crypto";
import { describe, it, expect, jest, beforeAll, afterAll, beforeEach } from "@jest/globals";
import { Channel, ChannelModel } from "amqplib";
import { pool } from "../../config/db";
import { ConsumidorRabbitMqTelemetria } from "../../events/consumers/rabbitmq-telemetria.consumer";
import { metricasValidacaoService } from "../../services/metricas-validacao.service";
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
  limparFilas,
  publicarEvento,
} from "./helpers/rabbitmq-validacao";

// US-19 de ponta a ponta com PostgreSQL e RabbitMQ reais. Execute com
// VALIDACAO_TEST_DATABASE_URL e RABBITMQ_TEST_URL apontando para instâncias de teste.
const databaseUrl = process.env.VALIDACAO_TEST_DATABASE_URL;
const rabbitUrl = process.env.RABBITMQ_TEST_URL;
const integration = databaseUrl && rabbitUrl ? describe : describe.skip;

integration("US-19 - valor fisicamente impossível (PostgreSQL e RabbitMQ)", () => {
  const schema = `validacao_us19_${randomUUID().replaceAll("-", "")}`;
  let admin: { connection: ChannelModel; channel: Channel };
  let consumidor: ConsumidorRabbitMqTelemetria;
  let estacao: string;

  const medidas = async () => {
    const { rows } = await pool.query(
      `SELECT s.codigo, m.unixtime, m.valor_bruto, m.valor, m.valida, e.municipio
       FROM medidas m
       JOIN sensores s ON s.id = m.sensor_id
       JOIN estacoes e ON e.id = s.estacao_id
       ORDER BY s.codigo, m.unixtime`,
    );
    return rows;
  };

  const evento = (leituras: Array<[string, number]>, unixtime = 1792400000) => ({
    staging_id: randomUUID(),
    estacao_uuid: estacao,
    unixtime,
    leituras: leituras.map(([sensor, valor]) => ({ sensor, valor })),
  });

  beforeAll(async () => {
    jest.spyOn(logger, "info").mockImplementation(() => undefined);
    jest.spyOn(logger, "warn").mockImplementation(() => undefined);
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
    await pool.query("TRUNCATE medidas, sensores, estacoes CASCADE");
    await limparFilas(admin.channel);
    metricasValidacaoService.reset();
    estacao = randomUUID();
    await cadastrarEstacao(pool, estacao, "Jacareí");
    await cadastrarSensor(pool, { estacaoId: estacao, codigo: "T-01", tipo: "Temperatura" });
    await cadastrarSensor(pool, { estacaoId: estacao, codigo: "UR-01", tipo: "Umidade Relativa" });
    await cadastrarSensor(pool, { estacaoId: estacao, codigo: "V-01", tipo: "Velocidade do Vento" });
  });

  it("mensagem com T-01 23,4 e UR-01 120,0 grava as duas, T-01 válida e UR-01 inválida herdando o município", async () => {
    publicarEvento(admin.channel, evento([["T-01", 23.4], ["UR-01", 120.0]]));
    await esperar(async () => (await medidas()).length === 2, "duas medidas");

    expect(await medidas()).toEqual([
      expect.objectContaining({ codigo: "T-01", valor: "23.400000", valida: true, municipio: "Jacareí" }),
      expect.objectContaining({
        codigo: "UR-01",
        valor_bruto: "120.000000",
        valor: "120.000000",
        valida: false,
        municipio: "Jacareí",
      }),
    ]);
    expect(metricasValidacaoService.obterMetricas().medidasInvalidasGravadas).toBe(1);
    expect(await contarDlq(admin.channel)).toBe(0);
  });

  it("limites inclusivos: 0,0 e 100,0 válidas; 100,1 e -0,1 inválidas", async () => {
    const leituras: Array<[number, number]> = [[0.0, 1], [100.0, 2], [100.1, 3], [-0.1, 4]];
    for (const [valor, i] of leituras) {
      publicarEvento(admin.channel, evento([["UR-01", valor]], 1792400000 + i * 300));
    }
    await esperar(async () => (await medidas()).length === 4, "quatro medidas");

    expect((await medidas()).map((m) => [m.valor, m.valida])).toEqual([
      ["0.000000", true],
      ["100.000000", true],
      ["100.100000", false],
      ["-0.100000", false],
    ]);
    expect(metricasValidacaoService.obterMetricas().medidasInvalidasGravadas).toBe(2);
  });

  it("o mesmo 70,0 é inválido para temperatura e válido para vento", async () => {
    publicarEvento(admin.channel, evento([["T-01", 70], ["V-01", 70]]));
    await esperar(async () => (await medidas()).length === 2, "duas medidas");

    expect((await medidas()).map((m) => [m.codigo, m.valida])).toEqual([
      ["T-01", false],
      ["V-01", true],
    ]);
  });

  it("evento entregue de novo não duplica a medida inválida nem soma de novo no contador", async () => {
    const original = evento([["UR-01", 120]]);

    publicarEvento(admin.channel, original);
    await esperar(async () => (await medidas()).length === 1, "medida inválida");
    publicarEvento(admin.channel, original);
    publicarEvento(admin.channel, evento([["T-01", 20]], 1792400600));
    await esperar(async () => (await medidas()).length === 2, "evento seguinte processado");

    expect((await medidas()).filter((m) => m.codigo === "UR-01")).toHaveLength(1);
    expect(metricasValidacaoService.obterMetricas().medidasInvalidasGravadas).toBe(1);
  });

  it("sensor consertado volta a gerar medida válida e as inválidas antigas continuam inválidas", async () => {
    publicarEvento(admin.channel, evento([["UR-01", 150]], 1792400000));
    publicarEvento(admin.channel, evento([["UR-01", 55]], 1792400300));
    await esperar(async () => (await medidas()).length === 2, "duas medidas");

    expect((await medidas()).map((m) => m.valida)).toEqual([false, true]);
  });
});
