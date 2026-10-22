import { EventEmitter } from "node:events";
import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { ConsumeMessage } from "amqplib";
import {
  ConsumidorRabbitMqTelemetria,
  ESPERA_BANCO_MS,
} from "../../../events/consumers/rabbitmq-telemetria.consumer";
import { EventoTelemetriaDTO } from "../../../dto/evento-telemetria.dto";
import logger from "../../../utils/logger";

type MockAsync = jest.Mock<(...args: unknown[]) => Promise<unknown>>;

type CanalFalso = EventEmitter & {
  checkQueue: MockAsync;
  prefetch: MockAsync;
  consume: MockAsync;
  ack: jest.Mock;
  nack: jest.Mock;
  close: MockAsync;
};

// US-20 (TASK 20.01): banco fora do ar pausa o consumo e retoma quando ele volta.
describe("ConsumidorRabbitMqTelemetria - banco indisponível (US-20)", () => {
  let canais: CanalFalso[];
  let entregas: Array<(msg: ConsumeMessage | null) => void>;
  let connection: EventEmitter & { createChannel: MockAsync; close: MockAsync };
  let verificarBanco: jest.Mock<() => Promise<boolean>>;

  const evento: EventoTelemetriaDTO = {
    staging_id: "staging-1",
    estacao_uuid: "estacao-1",
    unixtime: 1792400000,
    leituras: [{ sensor: "T-01", valor: 20 }],
  };

  const bancoFora = () => Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), {
    code: "ECONNREFUSED",
  });

  const mensagem = () =>
    ({ content: Buffer.from(JSON.stringify(evento)), fields: {}, properties: {} }) as unknown as ConsumeMessage;

  const criarCanal = (): CanalFalso => {
    const canal = Object.assign(new EventEmitter(), {
      checkQueue: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({}),
      prefetch: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined),
      consume: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockImplementation(async (_fila, onMessage) => {
          entregas.push(onMessage as (msg: ConsumeMessage | null) => void);
          return { consumerTag: `ctag-${entregas.length}` };
        }),
      ack: jest.fn(),
      nack: jest.fn(),
      close: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    });
    canal.close.mockImplementation(async () => {
      canal.emit("close");
    });
    canais.push(canal);
    return canal;
  };

  const iniciar = async (processarEvento: (e: EventoTelemetriaDTO) => Promise<unknown>) => {
    const consumidor = new ConsumidorRabbitMqTelemetria({
      url: "amqp://localhost:5672",
      conectar: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(connection) as never,
      processarEvento,
      publicarDlq: async () => undefined,
      verificarBanco,
      esperaBancoMs: 10000,
      reconectarMs: 50,
    });
    await consumidor.iniciar();
    return consumidor;
  };

  const entregarNoCanalAtual = async (quantidade = 1) => {
    const entregar = entregas[entregas.length - 1];
    for (let i = 0; i < quantidade; i++) entregar(mensagem());
    await jest.advanceTimersByTimeAsync(0);
  };

  beforeEach(() => {
    jest.useFakeTimers();
    canais = [];
    entregas = [];
    jest.spyOn(logger, "info").mockImplementation(() => undefined);
    jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    jest.spyOn(logger, "error").mockImplementation(() => undefined);
    connection = Object.assign(new EventEmitter(), {
      createChannel: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockImplementation(async () => criarCanal()),
      close: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined),
    });
    verificarBanco = jest.fn<() => Promise<boolean>>().mockResolvedValue(false);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("o intervalo padrão entre as conferências do banco é de 10 segundos", () => {
    expect(ESPERA_BANCO_MS).toBe(10000);
  });

  it("banco fora do ar: não confirma nem devolve evento por evento; fecha o canal e pausa o consumo", async () => {
    const consumidor = await iniciar(async () => {
      throw bancoFora();
    });

    await entregarNoCanalAtual(3);

    const [canal] = canais;
    expect(canal.ack).not.toHaveBeenCalled();
    expect(canal.nack).not.toHaveBeenCalled();
    expect(canal.close).toHaveBeenCalledTimes(1);
    expect(consumidor.estaComConsumoPausado()).toBe(true);
    expect(logger.error).toHaveBeenCalledWith(
      "Banco de dados indisponível; consumo pausado até o banco responder",
      expect.objectContaining({ novaTentativaEmMs: 10000 }),
    );
    await consumidor.encerrar();
  });

  it("enquanto o banco não responde, confere a cada 10 segundos sem voltar a consumir", async () => {
    const consumidor = await iniciar(async () => {
      throw bancoFora();
    });
    await entregarNoCanalAtual();

    await jest.advanceTimersByTimeAsync(9999);
    expect(verificarBanco).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(verificarBanco).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(20000);
    expect(verificarBanco).toHaveBeenCalledTimes(3);

    expect(connection.createChannel).toHaveBeenCalledTimes(1);
    expect(consumidor.estaComConsumoPausado()).toBe(true);
    await consumidor.encerrar();
  });

  it("quando o banco responde, volta a consumir sozinho em um canal novo", async () => {
    const processarEvento = jest
      .fn<(e: EventoTelemetriaDTO) => Promise<unknown>>()
      .mockRejectedValueOnce(bancoFora())
      .mockResolvedValue({ recusadas: [] });
    const consumidor = await iniciar(processarEvento);
    await entregarNoCanalAtual();

    verificarBanco.mockResolvedValue(true);
    await jest.advanceTimersByTimeAsync(10000);

    expect(connection.createChannel).toHaveBeenCalledTimes(2);
    expect(consumidor.estaComConsumoPausado()).toBe(false);
    expect(consumidor.estaSaudavel()).toBe(true);

    await entregarNoCanalAtual();
    expect(canais[1].ack).toHaveBeenCalledTimes(1);
    await consumidor.encerrar();
  });

  it("canal fechado durante a pausa não reconecta antes de o banco voltar", async () => {
    const consumidor = await iniciar(async () => {
      throw bancoFora();
    });
    await entregarNoCanalAtual();

    await jest.advanceTimersByTimeAsync(5000);

    expect(connection.createChannel).toHaveBeenCalledTimes(1);
    await consumidor.encerrar();
  });

  it("erro do próprio evento com o banco no ar volta para a fila e não pausa", async () => {
    const consumidor = await iniciar(async () => {
      throw Object.assign(new Error("numeric field overflow"), { code: "22003" });
    });

    await entregarNoCanalAtual();

    expect(canais[0].nack).toHaveBeenCalledWith(expect.anything(), false, true);
    expect(canais[0].close).not.toHaveBeenCalled();
    expect(consumidor.estaComConsumoPausado()).toBe(false);
    await consumidor.encerrar();
  });

  it("encerrar cancela a conferência agendada do banco", async () => {
    const consumidor = await iniciar(async () => {
      throw bancoFora();
    });
    await entregarNoCanalAtual();

    await consumidor.encerrar();
    await jest.advanceTimersByTimeAsync(30000);

    expect(verificarBanco).not.toHaveBeenCalled();
  });

  it("falha ao conferir o banco conta como banco ainda indisponível", async () => {
    verificarBanco.mockRejectedValue(new Error("pool encerrado"));
    const consumidor = await iniciar(async () => {
      throw bancoFora();
    });
    await entregarNoCanalAtual();

    await jest.advanceTimersByTimeAsync(10000);

    expect(consumidor.estaComConsumoPausado()).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      "Banco de dados continua indisponível; consumo segue pausado",
      expect.anything(),
    );
    await consumidor.encerrar();
  });
});
