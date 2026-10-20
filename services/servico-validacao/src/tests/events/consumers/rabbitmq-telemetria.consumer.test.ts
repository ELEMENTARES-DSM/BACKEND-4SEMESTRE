import { EventEmitter } from "node:events";
import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { ConsumeMessage } from "amqplib";
import {
  ConsumidorRabbitMqTelemetria,
  FILA_VALIDACAO_TELEMETRIA,
  PREFETCH_VALIDACAO_TELEMETRIA,
} from "../../../events/consumers/rabbitmq-telemetria.consumer";
import { EventoTelemetriaDTO } from "../../../dto/evento-telemetria.dto";

type MockAsync = jest.Mock<(...args: unknown[]) => Promise<unknown>>;

type MockChannel = EventEmitter & {
  checkQueue: MockAsync;
  prefetch: MockAsync;
  consume: jest.Mock<
    (
      queue: string,
      onMessage: (msg: ConsumeMessage | null) => void,
      options?: unknown,
    ) => Promise<{ consumerTag: string }>
  >;
  ack: jest.Mock;
  nack: jest.Mock;
  close: MockAsync;
};

describe("ConsumidorRabbitMqTelemetria", () => {
  let channel: MockChannel;
  let connection: EventEmitter & {
    createChannel: MockAsync;
    close: MockAsync;
  };
  let callbackConsumo: ((msg: ConsumeMessage | null) => void) | undefined;

  const eventoValido: EventoTelemetriaDTO = {
    staging_id: "staging-1",
    estacao_uuid: "estacao-1",
    unixtime: 1792400000,
    leituras: [{ sensor: "TEMP-01", valor: 25.4 }],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    callbackConsumo = undefined;

    channel = Object.assign(new EventEmitter(), {
      checkQueue: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue({ queue: FILA_VALIDACAO_TELEMETRIA }),
      prefetch: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue(undefined),
      consume: jest
        .fn<
          (
            queue: string,
            onMessage: (msg: ConsumeMessage | null) => void,
            options?: unknown,
          ) => Promise<{ consumerTag: string }>
        >()
        .mockImplementation(async (_queue, onMessage) => {
          callbackConsumo = onMessage;
          return { consumerTag: "ctag-1" };
        }),
      ack: jest.fn(),
      nack: jest.fn(),
      close: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue(undefined),
    });

    connection = Object.assign(new EventEmitter(), {
      createChannel: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue(channel),
      close: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("configura prefetch(10), verifica a fila validacao.telemetria e inicia consumo manual (noAck: false)", async () => {
    const conectar = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue(connection) as never;
    const processarEvento = jest
      .fn<(e: EventoTelemetriaDTO) => Promise<unknown>>()
      .mockResolvedValue(undefined);

    const consumidor = new ConsumidorRabbitMqTelemetria({
      url: "amqp://localhost:5672",
      conectar,
      processarEvento,
    });

    await consumidor.iniciar();

    expect(channel.checkQueue).toHaveBeenCalledWith(FILA_VALIDACAO_TELEMETRIA);
    expect(channel.prefetch).toHaveBeenCalledWith(PREFETCH_VALIDACAO_TELEMETRIA);
    expect(channel.consume).toHaveBeenCalledWith(
      FILA_VALIDACAO_TELEMETRIA,
      expect.any(Function),
      { noAck: false },
    );
    expect(consumidor.obterEstadoSaude()).toEqual({
      rabbitmq: "conectado",
      fila: "disponivel",
    });

    await consumidor.encerrar();
  });

  it("envia ack somente após processarEvento concluir o commit no banco", async () => {
    const ordem: string[] = [];
    const conectar = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue(connection) as never;

    const processarEvento = jest
      .fn<(e: EventoTelemetriaDTO) => Promise<unknown>>()
      .mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 15));
        ordem.push("commit");
      });

    channel.ack.mockImplementation(() => {
      ordem.push("ack");
    });

    const consumidor = new ConsumidorRabbitMqTelemetria({
      url: "amqp://localhost:5672",
      conectar,
      processarEvento,
    });

    await consumidor.iniciar();

    const msg = {
      content: Buffer.from(JSON.stringify(eventoValido)),
    } as ConsumeMessage;

    callbackConsumo!(msg);
    // Antes do commit terminar, ack não pode ter sido chamado
    expect(channel.ack).not.toHaveBeenCalled();

    await new Promise((r) => setTimeout(r, 30));

    expect(processarEvento).toHaveBeenCalledWith(eventoValido);
    expect(channel.ack).toHaveBeenCalledWith(msg);
    expect(ordem).toEqual(["commit", "ack"]);

    await consumidor.encerrar();
  });

  it("não envia ack e faz nack quando o processamento/commit falha", async () => {
    const conectar = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue(connection) as never;
    const processarEvento = jest
      .fn<(e: EventoTelemetriaDTO) => Promise<unknown>>()
      .mockRejectedValue(new Error("Erro no commit"));

    const consumidor = new ConsumidorRabbitMqTelemetria({
      url: "amqp://localhost:5672",
      conectar,
      processarEvento,
    });

    await consumidor.iniciar();

    const msg = {
      content: Buffer.from(JSON.stringify(eventoValido)),
    } as ConsumeMessage;

    callbackConsumo!(msg);
    await new Promise((r) => setTimeout(r, 20));

    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(msg, false, true);

    await consumidor.encerrar();
  });

  it("tenta novamente sem encerrar o serviço quando a fila não existe e reflete no estado de saúde", async () => {
    let tentativa = 0;
    channel.checkQueue.mockImplementation(async () => {
      tentativa += 1;
      if (tentativa === 1) {
        throw new Error("NOT_FOUND - no queue 'validacao.telemetria'");
      }
      return { queue: FILA_VALIDACAO_TELEMETRIA };
    });

    const conectar = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue(connection) as never;

    const consumidor = new ConsumidorRabbitMqTelemetria({
      url: "amqp://localhost:5672",
      conectar,
      reconectarMs: 30,
      processarEvento: async () => undefined,
    });

    await consumidor.iniciar();

    // Na primeira tentativa a fila não existe: conexão ativa, mas fila indisponível
    expect(consumidor.obterEstadoSaude()).toEqual({
      rabbitmq: "conectado",
      fila: "indisponivel",
    });

    // Aguarda a nova tentativa automática
    await new Promise((r) => setTimeout(r, 60));

    expect(tentativa).toBeGreaterThanOrEqual(2);
    expect(consumidor.obterEstadoSaude()).toEqual({
      rabbitmq: "conectado",
      fila: "disponivel",
    });

    await consumidor.encerrar();
  });

  it("tenta reconectar quando a conexão inicial com o RabbitMQ falha", async () => {
    let tentativaConexao = 0;
    const conectar = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockImplementation(async () => {
        tentativaConexao += 1;
        if (tentativaConexao === 1) {
          throw new Error("ECONNREFUSED");
        }
        return connection;
      }) as never;

    const consumidor = new ConsumidorRabbitMqTelemetria({
      url: "amqp://localhost:5672",
      conectar,
      reconectarMs: 30,
      processarEvento: async () => undefined,
    });

    await consumidor.iniciar();

    expect(consumidor.obterEstadoSaude()).toEqual({
      rabbitmq: "desconectado",
      fila: "indisponivel",
    });

    await new Promise((r) => setTimeout(r, 60));

    expect(tentativaConexao).toBeGreaterThanOrEqual(2);
    expect(consumidor.obterEstadoSaude()).toEqual({
      rabbitmq: "conectado",
      fila: "disponivel",
    });

    await consumidor.encerrar();
  });
});
