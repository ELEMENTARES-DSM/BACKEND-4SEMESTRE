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
  lerDlq,
  limparFilas,
  publicarEvento,
} from "./helpers/rabbitmq-validacao";

// US-18 de ponta a ponta com PostgreSQL e RabbitMQ reais. Execute com
// VALIDACAO_TEST_DATABASE_URL e RABBITMQ_TEST_URL apontando para instâncias de teste.
const databaseUrl = process.env.VALIDACAO_TEST_DATABASE_URL;
const rabbitUrl = process.env.RABBITMQ_TEST_URL;
const integration = databaseUrl && rabbitUrl ? describe : describe.skip;

integration("US-18 - sensor inexistente ou inativo (PostgreSQL e RabbitMQ)", () => {
  const schema = `validacao_us18_${randomUUID().replaceAll("-", "")}`;
  let admin: { connection: ChannelModel; channel: Channel };
  let consumidor: ConsumidorRabbitMqTelemetria;
  let estacaoA: string;
  let estacaoB: string;

  const medidas = async () => {
    const { rows } = await pool.query(
      `SELECT s.codigo, m.valor_bruto, m.staging_id
       FROM medidas m JOIN sensores s ON s.id = m.sensor_id
       ORDER BY s.codigo`,
    );
    return rows;
  };

  const evento = (estacao: string, leituras: Array<[string, number]>, unixtime = 1792400000) => ({
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
    await pool.query("TRUNCATE medidas, sensores, estacoes");
    await limparFilas(admin.channel);
    metricasValidacaoService.reset();
    estacaoA = randomUUID();
    estacaoB = randomUUID();
    await cadastrarEstacao(pool, estacaoA);
    await cadastrarEstacao(pool, estacaoB);
  });

  it("T-01 ativo, PM-01 inativo e X-99 inexistente: grava T-01, PM-01 vai para o contador e só X-99 vai para a DLQ", async () => {
    await cadastrarSensor(pool, { estacaoId: estacaoA, codigo: "T-01" });
    await cadastrarSensor(pool, { estacaoId: estacaoA, codigo: "PM-01", tipo: "PM2.5", status: "Inativo" });
    const original = evento(estacaoA, [["T-01", 21.5], ["PM-01", 40], ["X-99", 7.25]]);

    publicarEvento(admin.channel, original);
    await esperar(async () => (await contarDlq(admin.channel)) === 1, "leitura recusada na DLQ");

    expect(await medidas()).toEqual([
      { codigo: "T-01", valor_bruto: "21.500000", staging_id: original.staging_id },
    ]);
    expect(metricasValidacaoService.obterMetricas().leiturasIgnoradasSensorInativo).toBe(1);

    const [recusa] = await lerDlq(admin.channel);
    expect(recusa.corpo).toEqual({
      staging_id: original.staging_id,
      estacao_uuid: estacaoA,
      unixtime: 1792400000,
      leituras: [{ sensor: "X-99", valor: 7.25 }],
      motivo: "Sensor inexistente na estação",
      recusado_em: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    });
    // Publicada pelo serviço, não pelo limite de entregas do RabbitMQ.
    expect(recusa.headers["x-death"]).toBeUndefined();
  });

  it("código que existe só em outra estação conta como inexistente", async () => {
    await cadastrarSensor(pool, { estacaoId: estacaoB, codigo: "T-01" });

    publicarEvento(admin.channel, evento(estacaoA, [["T-01", 20]]));
    await esperar(async () => (await contarDlq(admin.channel)) === 1, "leitura recusada na DLQ");

    expect(await medidas()).toEqual([]);
    const [recusa] = await lerDlq(admin.channel);
    expect(recusa.corpo).toMatchObject({
      estacao_uuid: estacaoA,
      leituras: [{ sensor: "T-01", valor: 20 }],
      motivo: "Sensor inexistente na estação",
    });
  });

  it("todos os sensores inativos: nenhuma medida, nada na DLQ e o contador soma o número de leituras", async () => {
    await cadastrarSensor(pool, { estacaoId: estacaoA, codigo: "PM-01", status: "Inativo" });
    await cadastrarSensor(pool, { estacaoId: estacaoA, codigo: "UR-01", status: "Inativo" });

    publicarEvento(admin.channel, evento(estacaoA, [["PM-01", 40], ["UR-01", 61.2]]));
    await esperar(
      async () => metricasValidacaoService.obterMetricas().leiturasIgnoradasSensorInativo === 2,
      "contador de inativos",
    );

    expect(await medidas()).toEqual([]);
    expect(await contarDlq(admin.channel)).toBe(0);
  });

  it("evento sem lista de leituras vai inteiro para a DLQ como \"Evento malformado\", sem nova tentativa", async () => {
    const semLeituras = { staging_id: randomUUID(), estacao_uuid: estacaoA, unixtime: 1792400300 };

    publicarEvento(admin.channel, semLeituras);
    await esperar(async () => (await contarDlq(admin.channel)) === 1, "evento malformado na DLQ");
    // Uma reentrega duplicaria a mensagem na DLQ: espera um pouco e confere de novo.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const mensagens = await lerDlq(admin.channel);
    expect(mensagens).toHaveLength(1);
    expect(mensagens[0].corpo).toMatchObject({
      staging_id: semLeituras.staging_id,
      estacao_uuid: estacaoA,
      unixtime: 1792400300,
      leituras: semLeituras,
      motivo: "Evento malformado",
    });
  });

  it("evento que não é JSON vai para a DLQ com o texto original", async () => {
    publicarEvento(admin.channel, "não é json");
    await esperar(async () => (await contarDlq(admin.channel)) === 1, "evento malformado na DLQ");

    const [mensagem] = await lerDlq(admin.channel);
    expect(mensagem.corpo).toMatchObject({
      staging_id: null,
      estacao_uuid: null,
      unixtime: null,
      leituras: "não é json",
      motivo: "Evento malformado",
    });
  });

  it("sensor reativado volta a gerar medidas normalmente", async () => {
    const pm = await cadastrarSensor(pool, { estacaoId: estacaoA, codigo: "PM-01", status: "Inativo" });

    publicarEvento(admin.channel, evento(estacaoA, [["PM-01", 40]], 1792400000));
    await esperar(
      async () => metricasValidacaoService.obterMetricas().leiturasIgnoradasSensorInativo === 1,
      "leitura ignorada",
    );

    await pool.query("UPDATE sensores SET status = 'Ativo' WHERE id = $1", [pm]);
    publicarEvento(admin.channel, evento(estacaoA, [["PM-01", 42]], 1792400300));
    await esperar(async () => (await medidas()).length === 1, "medida do sensor reativado");

    expect(await medidas()).toEqual([
      expect.objectContaining({ codigo: "PM-01", valor_bruto: "42.000000" }),
    ]);
  });

  it("evento entregue de novo não duplica medidas; a recusa pode repetir na DLQ com o mesmo staging_id", async () => {
    await cadastrarSensor(pool, { estacaoId: estacaoA, codigo: "T-01" });
    const original = evento(estacaoA, [["T-01", 20], ["X-99", 1]]);

    publicarEvento(admin.channel, original);
    publicarEvento(admin.channel, original);
    await esperar(async () => (await contarDlq(admin.channel)) === 2, "duas recusas na DLQ");

    expect(await medidas()).toHaveLength(1);
    const recusas = await lerDlq(admin.channel);
    expect(recusas.map((m) => m.corpo.staging_id)).toEqual([original.staging_id, original.staging_id]);
  });
});
