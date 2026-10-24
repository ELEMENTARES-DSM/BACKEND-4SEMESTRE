process.env.JWT_SECRET = process.env.JWT_SECRET ?? "segredo-integracao-reenvio";

import { randomUUID } from "node:crypto";
import { AddressInfo } from "node:net";
import { Server } from "node:http";
import { describe, it, expect, jest, beforeAll, afterAll, beforeEach } from "@jest/globals";
import { Channel, ChannelModel } from "amqplib";
import jwt from "jsonwebtoken";
import app from "../../app";
import { pool } from "../../config/db";
import { ConsumidorRabbitMqTelemetria } from "../../events/consumers/rabbitmq-telemetria.consumer";
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
  limparFilas,
} from "./helpers/rabbitmq-validacao";

// TASK 20.02 de ponta a ponta: a rota HTTP reenvia da DLQ real e as leituras
// viram medidas. Execute com VALIDACAO_TEST_DATABASE_URL e RABBITMQ_TEST_URL.
const databaseUrl = process.env.VALIDACAO_TEST_DATABASE_URL;
const rabbitUrl = process.env.RABBITMQ_TEST_URL;
const integration = databaseUrl && rabbitUrl ? describe : describe.skip;

integration("POST /validacao/dlq/reenviar (PostgreSQL e RabbitMQ)", () => {
  const schema = `validacao_rota_reenvio_${randomUUID().replaceAll("-", "")}`;
  let admin: { connection: ChannelModel; channel: Channel };
  let consumidor: ConsumidorRabbitMqTelemetria;
  let servidor: Server;
  let baseUrl: string;
  let estacao: string;

  const token = jwt.sign(
    { id: "admin-1", papel: "ADMINISTRADOR", municipio: null },
    process.env.JWT_SECRET as string,
    { algorithm: "HS256" },
  );

  const reenviar = (corpo: unknown = {}) =>
    fetch(`${baseUrl}/validacao/dlq/reenviar`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });

  beforeAll(async () => {
    jest.spyOn(logger, "info").mockImplementation(() => undefined);
    jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    process.env.RABBITMQ_URL = rabbitUrl;
    await prepararSchemaValidacao(pool, schema);
    admin = await conectarAdmin(rabbitUrl as string);
    await limparFilas(admin.channel);

    consumidor = new ConsumidorRabbitMqTelemetria({ url: rabbitUrl as string, reconectarMs: 200 });
    await consumidor.iniciar();
    await esperar(async () => consumidor.estaSaudavel(), "consumidor conectado");

    await new Promise<void>((resolve) => {
      servidor = app.listen(0, "127.0.0.1", () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    try {
      await new Promise<void>((resolve) => servidor.close(() => resolve()));
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
    estacao = randomUUID();
    await cadastrarEstacao(pool, estacao);
    await cadastrarSensor(pool, { estacaoId: estacao, codigo: "T-01" });
  });

  it("quantidade 10 com 30 na DLQ: responde 10 e 20, e os 10 viram medidas", async () => {
    for (let i = 0; i < 30; i++) {
      const evento = {
        staging_id: randomUUID(),
        estacao_uuid: estacao,
        unixtime: 1792400000 + i * 300,
        leituras: [{ sensor: "T-01", valor: 20 + i }],
      };
      admin.channel.sendToQueue(FILA_VALIDACAO_DLQ, Buffer.from(JSON.stringify(evento)), { persistent: true });
    }
    await esperar(async () => (await contarDlq(admin.channel)) === 30, "30 eventos na DLQ");

    const resposta = await reenviar({ quantidade: 10 });

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ reenviados: 10, restantes: 20 });
    await esperar(async () => {
      const { rows } = await pool.query("SELECT count(*)::int AS total FROM medidas");
      return rows[0].total === 10;
    }, "10 medidas");
  });

  it("quantidade inválida responde 400 e a DLQ fica como estava", async () => {
    admin.channel.sendToQueue(FILA_VALIDACAO_DLQ, Buffer.from("{}"), { persistent: true });
    await esperar(async () => (await contarDlq(admin.channel)) === 1, "evento na DLQ");

    const resposta = await reenviar({ quantidade: 0 });

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({ erro: "Quantidade inválida" });
    expect(await contarDlq(admin.channel)).toBe(1);
  });
});
