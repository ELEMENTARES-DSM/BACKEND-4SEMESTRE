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

type MockAsync = jest.Mock<(...args: unknown[]) => Promise<unknown>>;
type MockChannel = EventEmitter & {
  assertExchange: MockAsync;
  assertQueue: MockAsync;
  bindQueue: MockAsync;
  close: MockAsync;
  publish: jest.Mock<(...args: unknown[]) => boolean>;
};

describe("RabbitMqTelemetriaPublisher", () => {
  let channel: MockChannel;
  let publisher: RabbitMqTelemetriaPublisher;

  beforeEach(() => {
    jest.clearAllMocks();
    channel = Object.assign(new EventEmitter(), {
      assertExchange: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined),
      assertQueue: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined),
      bindQueue: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined),
      close: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined),
      publish: jest.fn<(...args: unknown[]) => boolean>(),
    }) as MockChannel;

    const connection = Object.assign(new EventEmitter(), {
      close: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined),
      createConfirmChannel: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(channel),
    });
    const conectar = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(connection) as never;
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
