import { EventEmitter } from "node:events";
import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { ConsumeMessage } from "amqplib";
import {
  ConsumidorRabbitMqTelemetria,
  PublicadorAlarmesFn,
  PublicadorDlq,
} from "../../../events/consumers/rabbitmq-telemetria.consumer";
import { AlarmeRow } from "../../../dto/alarme.dto";
import logger from "../../../utils/logger";

type MockAsync = jest.Mock<(...args: unknown[]) => Promise<unknown>>;

// Espera a condição sem tempo fixo: o processamento da mensagem é assíncrono.
async function esperarAte(condicao: () => boolean, limiteMs = 2000): Promise<void> {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > limiteMs) {
      throw new Error("Tempo esgotado esperando a condição");
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
}

// US-22 (TASK 22.03): alarmes do evento vão para alarme.disparado antes do ack.
describe("ConsumidorRabbitMqTelemetria - publicação de alarme.disparado (US-22)", () => {
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
  let publicarAlarmes: jest.Mock<PublicadorAlarmesFn>;
  let marcarAlarmesPublicados: jest.Mock<(ids: string[], publicadoEm: Date) => Promise<void>>;
  let agendarRepublicacaoAlarmes: jest.Mock;

  const agora = new Date("2026-10-24T13:00:02.000Z");
  const alarme = { id: "alarme-1", regra_id: "regra-1" } as AlarmeRow;
  const evento = { staging_id: "s-1", estacao_uuid: "e-1", unixtime: 1792400000, leituras: [{ sensor: "PM25-01", valor: 52.3 }] };
  const mensagem = () =>
    ({ content: Buffer.from(JSON.stringify(evento)), fields: {}, properties: {} }) as unknown as ConsumeMessage;

  const iniciar = async (resultado: unknown) => {
    const consumidor = new ConsumidorRabbitMqTelemetria({
      url: "amqp://localhost:5672",
      conectar: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(connection) as never,
      processarEvento: async () => resultado,
      publicarDlq,
      publicarAlarmes,
      marcarAlarmesPublicados,
      agendarRepublicacaoAlarmes,
      agora: () => agora,
    });
    await consumidor.iniciar();
    return consumidor;
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
    publicarDlq = jest.fn<PublicadorDlq>().mockImplementation(async (eventos) => {
      if (eventos.length > 0) ordem.push("dlq");
    });
    publicarAlarmes = jest.fn<PublicadorAlarmesFn>().mockImplementation(async () => {
      ordem.push("alarmes");
    });
    marcarAlarmesPublicados = jest.fn<(ids: string[], publicadoEm: Date) => Promise<void>>().mockImplementation(async () => {
      ordem.push("marcados");
    });
    agendarRepublicacaoAlarmes = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("ao conectar pede a republicação dos alarmes pendentes", async () => {
    const consumidor = await iniciar({});

    expect(agendarRepublicacaoAlarmes).toHaveBeenCalledTimes(1);
    await consumidor.encerrar();
  });

  it("publica os alarmes do evento, marca como publicados e só depois confirma o evento", async () => {
    const consumidor = await iniciar({ recusadas: [{ sensor: "X-99", valor: 1 }], alarmesAbertos: [alarme] });

    entregar(mensagem());
    await esperarAte(() => ordem.includes("ack"));

    expect(ordem).toEqual(["dlq", "alarmes", "marcados", "ack"]);
    expect(publicarAlarmes).toHaveBeenCalledWith([alarme]);
    expect(marcarAlarmesPublicados).toHaveBeenCalledWith(["alarme-1"], agora);
    await consumidor.encerrar();
  });

  it("evento sem alarme não publica nada em alarme.disparado", async () => {
    const consumidor = await iniciar({ recusadas: [], alarmesAbertos: [] });

    entregar(mensagem());
    await esperarAte(() => ordem.includes("ack"));

    expect(publicarAlarmes).not.toHaveBeenCalled();
    expect(marcarAlarmesPublicados).not.toHaveBeenCalled();
    await consumidor.encerrar();
  });

  it("falha na publicação deixa o alarme pendente, agenda a republicação e confirma o evento assim mesmo", async () => {
    publicarAlarmes.mockRejectedValueOnce(new Error("canal fechado"));
    const consumidor = await iniciar({ alarmesAbertos: [alarme] });
    agendarRepublicacaoAlarmes.mockClear();

    entregar(mensagem());
    await esperarAte(() => ordem.includes("ack"));

    expect(marcarAlarmesPublicados).not.toHaveBeenCalled();
    expect(agendarRepublicacaoAlarmes).toHaveBeenCalledTimes(1);
    expect(channel.nack).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      "Falha ao publicar alarme.disparado; alarme fica pendente de publicação",
      { alarmes: ["alarme-1"], erro: "canal fechado" },
    );
    await consumidor.encerrar();
  });

  it("publicarAlarmes do consumidor usa o publicador configurado (usado pelo republicador)", async () => {
    const consumidor = await iniciar({});

    await consumidor.publicarAlarmes([alarme]);

    expect(publicarAlarmes).toHaveBeenCalledWith([alarme]);
    await consumidor.encerrar();
  });
});
