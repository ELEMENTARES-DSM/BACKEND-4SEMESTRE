import { EventEmitter } from "node:events";
import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { ConsumeMessage } from "amqplib";
import {
  ConsumidorRabbitMqTelemetria,
  FILA_VALIDACAO_TELEMETRIA,
  PublicadorDlq,
} from "../../../events/consumers/rabbitmq-telemetria.consumer";
import { EventoMalformadoError } from "../../../services/processar-telemetria.service";
import { EventoRecusadoDTO, EventoTelemetriaDTO } from "../../../dto/evento-telemetria.dto";
import logger from "../../../utils/logger";

type MockAsync = jest.Mock<(...args: unknown[]) => Promise<unknown>>;

// US-18 (TASK 18.02): recusas vão para a validacao.dlq antes do ack do evento original.
describe("ConsumidorRabbitMqTelemetria - envio para a validacao.dlq (US-18)", () => {
  let channel: EventEmitter & {
    checkQueue: MockAsync;
    prefetch: MockAsync;
    consume: MockAsync;
    ack: jest.Mock;
    nack: jest.Mock;
    close: MockAsync;
  };
  let connection: EventEmitter & { createChannel: MockAsync; close: MockAsync };
  let entregar: (msg: ConsumeMessage | null) => void;
  let ordem: string[];
  let publicarDlq: jest.Mock<PublicadorDlq>;

  const agora = new Date("2026-10-20T14:05:08.000Z");

  const evento: EventoTelemetriaDTO = {
    staging_id: "staging-1",
    estacao_uuid: "estacao-1",
    unixtime: 1792400000,
    leituras: [
      { sensor: "T-01", valor: 20 },
      { sensor: "X-98", valor: 1.5 },
      { sensor: "X-99", valor: 7 },
    ],
  };

  const mensagem = (conteudo: string) =>
    ({ content: Buffer.from(conteudo), fields: {}, properties: {} }) as unknown as ConsumeMessage;

  const iniciar = async (processarEvento: (e: EventoTelemetriaDTO) => Promise<unknown>) => {
    const consumidor = new ConsumidorRabbitMqTelemetria({
      url: "amqp://localhost:5672",
      conectar: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(connection) as never,
      processarEvento,
      publicarDlq,
      agora: () => agora,
    });
    await consumidor.iniciar();
    return consumidor;
  };

  const processarMensagem = async (conteudo: string) => {
    entregar(mensagem(conteudo));
    await new Promise((resolve) => setTimeout(resolve, 20));
  };

  beforeEach(() => {
    ordem = [];
    jest.spyOn(logger, "info").mockImplementation(() => undefined);
    jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    jest.spyOn(logger, "error").mockImplementation(() => undefined);

    channel = Object.assign(new EventEmitter(), {
      checkQueue: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({}),
      prefetch: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined),
      consume: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockImplementation(async (_fila, onMessage) => {
          entregar = onMessage as (msg: ConsumeMessage | null) => void;
          return { consumerTag: "ctag" };
        }),
      ack: jest.fn(() => ordem.push("ack")),
      nack: jest.fn(() => ordem.push("nack")),
      close: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined),
    });
    connection = Object.assign(new EventEmitter(), {
      createChannel: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(channel),
      close: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined),
    });
    publicarDlq = jest.fn<PublicadorDlq>().mockImplementation(async () => {
      ordem.push("dlq");
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("envia cada leitura de sensor inexistente como evento próprio e só depois confirma o original", async () => {
    const consumidor = await iniciar(async () => ({
      recusadas: [
        { sensor: "X-98", valor: 1.5 },
        { sensor: "X-99", valor: 7 },
      ],
    }));

    await processarMensagem(JSON.stringify(evento));

    const esperado = (sensor: string, valor: number): EventoRecusadoDTO => ({
      staging_id: "staging-1",
      estacao_uuid: "estacao-1",
      unixtime: 1792400000,
      leituras: [{ sensor, valor }],
      motivo: "Sensor inexistente na estação",
      recusado_em: "2026-10-20T14:05:08.000Z",
    });
    expect(publicarDlq).toHaveBeenCalledWith([esperado("X-98", 1.5), esperado("X-99", 7)]);
    expect(ordem).toEqual(["dlq", "ack"]);
    expect(channel.nack).not.toHaveBeenCalled();
    await consumidor.encerrar();
  });

  it("sem leituras recusadas, nada é publicado e o evento é confirmado", async () => {
    const consumidor = await iniciar(async () => ({ recusadas: [] }));

    await processarMensagem(JSON.stringify(evento));

    expect(publicarDlq).toHaveBeenCalledWith([]);
    expect(channel.ack).toHaveBeenCalledTimes(1);
    await consumidor.encerrar();
  });

  it("se o RabbitMQ não confirmar a DLQ, o evento não é confirmado e volta para a fila", async () => {
    publicarDlq.mockRejectedValue(new Error("RabbitMQ não confirmou"));
    const consumidor = await iniciar(async () => ({ recusadas: [{ sensor: "X-99", valor: 7 }] }));

    await processarMensagem(JSON.stringify(evento));

    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(expect.anything(), false, true);
    await consumidor.encerrar();
  });

  it("evento que não é JSON vai inteiro para a DLQ como \"Evento malformado\" e é confirmado", async () => {
    const processarEvento = jest.fn<(e: EventoTelemetriaDTO) => Promise<unknown>>();
    const consumidor = await iniciar(processarEvento);

    await processarMensagem("isto não é json");

    expect(processarEvento).not.toHaveBeenCalled();
    expect(publicarDlq).toHaveBeenCalledWith([
      {
        staging_id: null,
        estacao_uuid: null,
        unixtime: null,
        leituras: "isto não é json",
        motivo: "Evento malformado",
        recusado_em: "2026-10-20T14:05:08.000Z",
      },
    ]);
    expect(ordem).toEqual(["dlq", "ack"]);
    await consumidor.encerrar();
  });

  it("evento sem lista de leituras utilizável vai para a DLQ com o conteúdo original, sem nova tentativa", async () => {
    const consumidor = await iniciar(async () => {
      throw new EventoMalformadoError("Evento de telemetria inválido");
    });
    const semLeituras = { staging_id: "staging-2", estacao_uuid: "estacao-1", unixtime: 1792400300 };

    await processarMensagem(JSON.stringify(semLeituras));

    expect(publicarDlq).toHaveBeenCalledWith([
      {
        staging_id: "staging-2",
        estacao_uuid: "estacao-1",
        unixtime: 1792400300,
        leituras: semLeituras,
        motivo: "Evento malformado",
        recusado_em: "2026-10-20T14:05:08.000Z",
      },
    ]);
    expect(channel.ack).toHaveBeenCalledTimes(1);
    expect(channel.nack).not.toHaveBeenCalled();
    await consumidor.encerrar();
  });

  it("se a DLQ falhar para o evento malformado, ele não é confirmado", async () => {
    publicarDlq.mockRejectedValue(new Error("canal fechado"));
    const consumidor = await iniciar(async () => undefined);

    await processarMensagem("{quebrado");

    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(expect.anything(), false, true);
    await consumidor.encerrar();
  });

  it("erro que não é de formato (ex.: banco) continua voltando para a fila sem ir à DLQ", async () => {
    const consumidor = await iniciar(async () => {
      throw new Error("connection terminated");
    });

    await processarMensagem(JSON.stringify(evento));

    expect(publicarDlq).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(expect.anything(), false, true);
    expect(channel.checkQueue).toHaveBeenCalledWith(FILA_VALIDACAO_TELEMETRIA);
    await consumidor.encerrar();
  });
});
