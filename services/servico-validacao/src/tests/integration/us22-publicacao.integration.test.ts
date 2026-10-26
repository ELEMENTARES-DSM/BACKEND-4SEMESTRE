import { randomUUID } from "node:crypto";
import { describe, it, expect, jest, beforeAll, afterAll, beforeEach, afterEach } from "@jest/globals";
import amqp, { Channel, ChannelModel } from "amqplib";
import { pool } from "../../config/db";
import { ConsumidorRabbitMqTelemetria } from "../../events/consumers/rabbitmq-telemetria.consumer";
import {
  ARGUMENTOS_FILA_NOTIFICACAO,
  FILA_NOTIFICACAO_ALARMES,
  FILA_NOTIFICACAO_DLQ,
  PublicadorAlarmes,
  declararTopologiaAlarmes,
} from "../../events/publishers/rabbitmq-alarme.publisher";
import { RepublicadorAlarmes } from "../../services/republicar-alarmes.service";
import logger from "../../utils/logger";
import {
  cadastrarEstacao,
  cadastrarRegra,
  cadastrarSensor,
  prepararSchemaValidacao,
} from "./helpers/banco-validacao";
import { conectarAdmin, esperar, limparFilas, publicarEvento } from "./helpers/rabbitmq-validacao";

// US-22 (TASK 22.03) com PostgreSQL e RabbitMQ reais. Execute com
// VALIDACAO_TEST_DATABASE_URL e RABBITMQ_TEST_URL apontando para instâncias de teste.
const databaseUrl = process.env.VALIDACAO_TEST_DATABASE_URL;
const rabbitUrl = process.env.RABBITMQ_TEST_URL;
const integration = databaseUrl && rabbitUrl ? describe : describe.skip;

integration("US-22 - publicação de alarme.disparado (PostgreSQL e RabbitMQ)", () => {
  const schema = `validacao_us22p_${randomUUID().replaceAll("-", "")}`;
  let admin: { connection: ChannelModel; channel: Channel };
  let consumidor: ConsumidorRabbitMqTelemetria | undefined;
  let estacao: string;
  let pm25: string;

  const contarNaFila = async () => (await admin.channel.checkQueue(FILA_NOTIFICACAO_ALARMES)).messageCount;
  const contarMedidas = async () =>
    Number((await pool.query<{ total: string }>("SELECT count(*) AS total FROM medidas")).rows[0].total);
  const alarmes = async () =>
    (await pool.query("SELECT id, publicado_em FROM alarmes ORDER BY criado_em")).rows;

  const evento = (valor: number, unixtime = 1792400000) => ({
    staging_id: randomUUID(),
    estacao_uuid: estacao,
    unixtime,
    leituras: [{ sensor: "PM25-01", valor }],
  });

  const iniciarConsumidor = async (opcoes: Partial<ConstructorParameters<typeof ConsumidorRabbitMqTelemetria>[0]> = {}) => {
    consumidor = new ConsumidorRabbitMqTelemetria({ url: rabbitUrl as string, reconectarMs: 200, ...opcoes });
    await consumidor.iniciar();
    await esperar(async () => consumidor?.estaSaudavel() === true, "consumidor conectado");
  };

  beforeAll(async () => {
    jest.spyOn(logger, "info").mockImplementation(() => undefined);
    jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    jest.spyOn(logger, "error").mockImplementation(() => undefined);
    await prepararSchemaValidacao(pool, schema);
    admin = await conectarAdmin(rabbitUrl as string);
    await declararTopologiaAlarmes(admin.channel);
  });

  afterAll(async () => {
    try {
      await limparFilas(admin.channel);
      await admin.channel.purgeQueue(FILA_NOTIFICACAO_ALARMES);
      await admin.channel.purgeQueue(FILA_NOTIFICACAO_DLQ);
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
    estacao = randomUUID();
    await cadastrarEstacao(pool, estacao, "São José dos Campos");
    pm25 = await cadastrarSensor(pool, { estacaoId: estacao, codigo: "PM25-01", tipo: "PM2.5" });
  });

  afterEach(async () => {
    await consumidor?.encerrar();
    consumidor = undefined;
  });

  it("alarme gravado vira um evento em notificacao.alarmes, no contrato, e fica marcado como publicado", async () => {
    const regra = await cadastrarRegra(pool, { sensorId: pm25, operador: ">=", limite: "50.00" });
    await iniciarConsumidor();

    publicarEvento(admin.channel, evento(52.3));
    await esperar(async () => (await contarNaFila()) === 1, "evento alarme.disparado");

    const msg = await admin.channel.get(FILA_NOTIFICACAO_ALARMES, { noAck: true });
    expect(msg).not.toBe(false);
    const corpo = JSON.parse((msg as amqp.GetMessage).content.toString("utf-8"));
    const [gravado] = await alarmes();
    expect((msg as amqp.GetMessage).properties.messageId).toBe(gravado.id);
    expect(corpo).toEqual({
      alarme_id: gravado.id,
      regra_id: regra,
      medida_id: expect.any(String),
      sensor_id: pm25,
      estacao_id: estacao,
      municipio: "São José dos Campos",
      valor: "52.300000",
      operador: ">=",
      limite: "50.00",
      severidade: "CRITICO",
      lido_em: new Date(1792400000 * 1000).toISOString(),
      criado_em: expect.any(String),
    });
    await esperar(async () => (await alarmes())[0].publicado_em !== null, "publicado_em preenchido");
  });

  it("telemetria entregue de novo não publica o alarme outra vez", async () => {
    await cadastrarRegra(pool, { sensorId: pm25, operador: ">=", limite: "50.00" });
    await iniciarConsumidor();
    const original = evento(52.3);

    publicarEvento(admin.channel, original);
    await esperar(async () => (await contarNaFila()) === 1, "primeiro evento");
    publicarEvento(admin.channel, original);
    publicarEvento(admin.channel, evento(10, 1792400300));
    await esperar(async () => (await contarMedidas()) === 2, "evento seguinte processado");

    expect(await contarNaFila()).toBe(1);
  });

  it("com a publicação falhando o alarme fica pendente e o republicador publica depois", async () => {
    await cadastrarRegra(pool, { sensorId: pm25, operador: ">=", limite: "50.00" });
    const agendar = jest.fn();
    await iniciarConsumidor({
      publicarAlarmes: async () => {
        throw new Error("canal fechado");
      },
      agendarRepublicacaoAlarmes: agendar,
    });

    publicarEvento(admin.channel, evento(52.3));
    await esperar(async () => (await contarMedidas()) === 1, "medida gravada");
    await esperar(async () => agendar.mock.calls.length >= 2, "republicação agendada");
    expect((await alarmes())[0].publicado_em).toBeNull();
    expect(await contarNaFila()).toBe(0);

    const publicador = new PublicadorAlarmes(() => admin.connection);
    await new RepublicadorAlarmes({ publicar: (pendentes) => publicador.publicar(pendentes) }).executar();
    publicador.descartarCanal();

    expect(await contarNaFila()).toBe(1);
    expect((await alarmes())[0].publicado_em).not.toBeNull();
  });

  it("a fila declarada aceita os mesmos argumentos do contrato e recusa outros", async () => {
    const conexao = await amqp.connect(rabbitUrl as string);
    try {
      const canal = await conexao.createChannel();
      await canal.assertQueue(FILA_NOTIFICACAO_ALARMES, { durable: true, arguments: { ...ARGUMENTOS_FILA_NOTIFICACAO } });
      await canal.close();

      const outro = await conexao.createChannel();
      outro.on("error", () => undefined);
      await expect(
        outro.assertQueue(FILA_NOTIFICACAO_ALARMES, { durable: true, arguments: { "x-queue-type": "classic" } }),
      ).rejects.toThrow(/PRECONDITION_FAILED/);
    } finally {
      await conexao.close().catch(() => undefined);
    }
  });
});
