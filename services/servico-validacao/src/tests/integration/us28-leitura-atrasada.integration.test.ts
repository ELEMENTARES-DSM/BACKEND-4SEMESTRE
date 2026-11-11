import { randomUUID } from "node:crypto";
import { describe, it, expect, jest, beforeAll, afterAll, beforeEach } from "@jest/globals";
import { Channel, ChannelModel } from "amqplib";
import { pool } from "../../config/db";
import { ConsumidorRabbitMqTelemetria } from "../../events/consumers/rabbitmq-telemetria.consumer";
import {
  FILA_NOTIFICACAO_ALARMES,
  declararTopologiaAlarmes,
} from "../../events/publishers/rabbitmq-alarme.publisher";
import { metricasValidacaoService } from "../../services/metricas-validacao.service";
import logger from "../../utils/logger";
import {
  cadastrarEstacao,
  cadastrarRegra,
  cadastrarSensor,
  prepararSchemaValidacao,
} from "./helpers/banco-validacao";
import { conectarAdmin, esperar, limparFilas, publicarEvento } from "./helpers/rabbitmq-validacao";

// US-28: leituras antigas entram no histórico, mas não abrem nem normalizam alarmes.
// Execute com VALIDACAO_TEST_DATABASE_URL e RABBITMQ_TEST_URL.
const databaseUrl = process.env.VALIDACAO_TEST_DATABASE_URL;
const rabbitUrl = process.env.RABBITMQ_TEST_URL;
const integration = databaseUrl && rabbitUrl ? describe : describe.skip;

integration("US-28 - leitura atrasada sem avaliação de regras", () => {
  const schema = `validacao_us28_${randomUUID().replaceAll("-", "")}`;
  let admin: { connection: ChannelModel; channel: Channel };
  let consumidor: ConsumidorRabbitMqTelemetria;
  let estacao: string;
  let pm25: string;

  const evento = (valor: number, unixtime: number) => ({
    staging_id: randomUUID(),
    estacao_uuid: estacao,
    unixtime,
    leituras: [{ sensor: "PM25-01", valor }],
  });
  const contarMedidas = async () =>
    Number((await pool.query<{ total: string }>("SELECT count(*) AS total FROM medidas")).rows[0].total);
  const alarmes = async () =>
    (await pool.query<{ situacao: string }>("SELECT situacao FROM alarmes ORDER BY criado_em")).rows;
  const contarAvisos = async () =>
    (await admin.channel.checkQueue(FILA_NOTIFICACAO_ALARMES)).messageCount;
  const unixAgora = () => Math.floor(Date.now() / 1000);

  beforeAll(async () => {
    jest.spyOn(logger, "info").mockImplementation(() => undefined);
    jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    jest.spyOn(logger, "error").mockImplementation(() => undefined);
    await prepararSchemaValidacao(pool, schema);
    admin = await conectarAdmin(rabbitUrl as string);
    await declararTopologiaAlarmes(admin.channel);
    await limparFilas(admin.channel);
    await admin.channel.purgeQueue(FILA_NOTIFICACAO_ALARMES);
    consumidor = new ConsumidorRabbitMqTelemetria({ url: rabbitUrl as string, reconectarMs: 200 });
    await consumidor.iniciar();
    await esperar(async () => consumidor.estaSaudavel(), "consumidor conectado");
  });

  afterAll(async () => {
    try {
      await consumidor.encerrar();
      await limparFilas(admin.channel);
      await admin.channel.purgeQueue(FILA_NOTIFICACAO_ALARMES);
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
    await admin.channel.purgeQueue(FILA_NOTIFICACAO_ALARMES);
    metricasValidacaoService.reset();
    estacao = randomUUID();
    await cadastrarEstacao(pool, estacao, "São José dos Campos");
    pm25 = await cadastrarSensor(pool, { estacaoId: estacao, codigo: "PM25-01", tipo: "PM2.5" });
  });

  it("grava uma leitura atrasada que viola regra sem criar alarme nem aviso", async () => {
    await cadastrarRegra(pool, { sensorId: pm25, operador: ">=", limite: "50.00" });
    const unixtime = unixAgora() - 2 * 60 * 60;

    publicarEvento(admin.channel, evento(52.3, unixtime));
    await esperar(async () =>
      (await contarMedidas()) === 1 &&
      metricasValidacaoService.obterMetricas().leiturasAtrasadasSemAvaliacao === 1,
    "medida atrasada gravada sem avaliação");

    const { rows } = await pool.query<{ unixtime: string }>("SELECT unixtime FROM medidas");
    expect(Number(rows[0].unixtime)).toBe(unixtime);
    expect(await alarmes()).toEqual([]);
    expect(await contarAvisos()).toBe(0);
  });

  it("deve manter o alarme aberto quando chega leitura atrasada, mais nova que o alarme, que não viola a regra", async () => {
  const regra = await cadastrarRegra(pool, { sensorId: pm25, operador: ">=", limite: "50.00" });
  // Alarme aberto há 3 h, inserido direto: se viesse pelo consumidor, a própria leitura seria atrasada.
  const alarmeUnix = unixAgora() - 3 * 60 * 60;
  const {
    rows: [medida],
  } = await pool.query<{ id: string }>(
    `INSERT INTO medidas (sensor_id, unixtime, valor_bruto, valor, valida, staging_id, criado_em)
     VALUES ($1, $2, 52.3, 52.3, TRUE, $3, now()) RETURNING id`,
    [pm25, alarmeUnix, randomUUID()],
  );
  await pool.query(
    `INSERT INTO alarmes (regra_id, medida_id, sensor_id, estacao_id, municipio, valor, operador, limite, severidade, lido_em)
     VALUES ($1, $2, $3, $4, 'São José dos Campos', 52.3, '>=', 50, 'CRITICO', to_timestamp($5))`,
    [regra, medida.id, pm25, estacao, alarmeUnix],
  );

  publicarEvento(admin.channel, evento(20, unixAgora() - 2 * 60 * 60));
  await esperar(async () =>
    (await contarMedidas()) === 2 &&
    metricasValidacaoService.obterMetricas().leiturasAtrasadasSemAvaliacao === 1,
  "leitura atrasada gravada");

  expect(await alarmes()).toEqual([{ situacao: "aberto" }]);
  expect(await contarAvisos()).toBe(0);
  });
});
