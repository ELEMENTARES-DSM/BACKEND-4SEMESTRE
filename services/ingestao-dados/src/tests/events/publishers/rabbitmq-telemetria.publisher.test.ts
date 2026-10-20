import { EventEmitter } from "node:events";
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import {
  marcarPendente,
  marcarPublicada,
  reservarProximaPendente,
  tentarBloquearPublicador,
} from "../../../repositories/staging.repository";
import { RabbitMqTelemetriaPublisher } from "../../../events/publishers/rabbitmq-telemetria.publisher";

jest.mock("../../../repositories/staging.repository");

const registro = {
  id: "staging-1",
  estacao_uuid: "estacao-1",
  unixtime: "1792400000",
  payload: { leituras: [{ sensor: "TMP", valor: 23 }] },
};

describe("RabbitMqTelemetriaPublisher", () => {
  let channel: EventEmitter & Record<string, jest.Mock>;
  let publisher: RabbitMqTelemetriaPublisher;

  beforeEach(() => {
    jest.clearAllMocks();
    channel = Object.assign(new EventEmitter(), {
      assertExchange: jest.fn().mockResolvedValue(undefined),
      assertQueue: jest.fn().mockResolvedValue(undefined),
      bindQueue: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
      publish: jest.fn(),
    });

    const connection = Object.assign(new EventEmitter(), {
      close: jest.fn().mockResolvedValue(undefined),
      createConfirmChannel: jest.fn().mockResolvedValue(channel),
    });
    const conectar = jest.fn().mockResolvedValue(connection) as never;
    publisher = new RabbitMqTelemetriaPublisher({ url: "amqp://test", conectar });
    jest.mocked(tentarBloquearPublicador).mockResolvedValue({
      liberar: async () => undefined,
    });
    jest.mocked(reservarProximaPendente).mockResolvedValueOnce(registro).mockResolvedValue(null);
  });

  it("marca como publicada após confirmação positiva do broker", async () => {
    channel.publish.mockImplementation((_exchange, _key, _content, options, callback) => {
      expect(options).toMatchObject({ persistent: true, mandatory: true });
      (callback as (erro?: Error | null) => void)(null);
      return true;
    });

    await publisher.iniciar();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(marcarPublicada).toHaveBeenCalledWith(registro.id);
    expect(marcarPendente).not.toHaveBeenCalled();
    await publisher.encerrar();
  });

  it("mantém pendente quando o broker rejeita a confirmação", async () => {
    channel.publish.mockImplementation((_exchange, _key, _content, _options, callback) => {
      (callback as (erro?: Error | null) => void)(new Error("nack"));
      return true;
    });

    await publisher.iniciar();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(marcarPublicada).not.toHaveBeenCalled();
    expect(marcarPendente).toHaveBeenCalledWith(registro.id, "nack");
    await publisher.encerrar();
  });

  it("mantém pendente quando mandatory é devolvida sem rota, mesmo com confirmação positiva", async () => {
    channel.publish.mockImplementation((_exchange, _key, _content, _options, callback) => {
      channel.emit("return", {
        fields: { replyCode: 312, replyText: "NO_ROUTE" },
      });
      (callback as (erro?: Error | null) => void)(null);
      return true;
    });

    await publisher.iniciar();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(marcarPublicada).not.toHaveBeenCalled();
    expect(marcarPendente).toHaveBeenCalledWith(
      registro.id,
      "Mensagem devolvida pelo RabbitMQ: RabbitMQ 312: NO_ROUTE",
    );
    await publisher.encerrar();
  });
});
