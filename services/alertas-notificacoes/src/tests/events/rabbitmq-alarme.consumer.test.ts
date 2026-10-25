import { EventEmitter } from "node:events";
import { ConsumeMessage } from "amqplib";
import {
  ARGUMENTOS_FILA_NOTIFICACAO,
  ConsumidorRabbitMqAlarmes,
  EXCHANGE_ALARME_DISPARADO,
  EXCHANGE_NOTIFICACAO_DLX,
  FILA_NOTIFICACAO_ALARMES,
  FILA_NOTIFICACAO_DLQ,
  ProcessadorEventoAlarme,
  lerEventoAlarme,
} from "../../events/consumers/rabbitmq-alarme.consumer";
import logger from "../../utils/logger";

// Espera a condição sem tempo fixo: o processamento da mensagem é assíncrono.
async function esperarAte(condicao: () => boolean, limiteMs = 2000): Promise<void> {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > limiteMs) throw new Error("Tempo esgotado esperando a condição");
    await new Promise((resolve) => setImmediate(resolve));
  }
}

const evento = {
  alarme_id: "0b6f2a4e-1c3d-4e5f-8a9b-1c2d3e4f5a6b",
  regra_id: "7b1e2c3d-4f5a-4b6c-8d7e-9f0a1b2c3d4e",
  medida_id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  sensor_id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  estacao_id: "9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  municipio: "São José dos Campos",
  valor: "52.300000",
  operador: ">=",
  limite: "50.00",
  severidade: "CRITICO",
  lido_em: "2026-10-24T13:00:00.000Z",
  criado_em: "2026-10-24T13:00:01.412Z",
};

describe("ConsumidorRabbitMqAlarmes (US-23)", () => {
  let channel: EventEmitter & Record<string, jest.Mock>;
  let connection: EventEmitter & { createChannel: jest.Mock; close: jest.Mock };
  let entregar: (msg: ConsumeMessage | null) => void;
  let processarEvento: jest.Mock<ReturnType<ProcessadorEventoAlarme>, Parameters<ProcessadorEventoAlarme>>;
  let consumidor: ConsumidorRabbitMqAlarmes | undefined;

  const mensagem = (conteudo: unknown) =>
    ({
      content: Buffer.from(typeof conteudo === "string" ? conteudo : JSON.stringify(conteudo)),
      fields: {},
      properties: { messageId: "m-1" },
    }) as unknown as ConsumeMessage;

  const iniciar = async (opcoes: { verificarBanco?: () => Promise<boolean>; esperaBancoMs?: number } = {}) => {
    consumidor = new ConsumidorRabbitMqAlarmes({
      url: "amqp://localhost:5672",
      conectar: jest.fn().mockResolvedValue(connection),
      processarEvento,
      reconectarMs: 10,
      ...opcoes,
    });
    await consumidor.iniciar();
  };

  beforeEach(() => {
    jest.spyOn(logger, "info").mockImplementation(() => undefined);
    jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    jest.spyOn(logger, "error").mockImplementation(() => undefined);
    channel = Object.assign(new EventEmitter(), {
      assertExchange: jest.fn().mockResolvedValue({}),
      assertQueue: jest.fn().mockResolvedValue({}),
      bindQueue: jest.fn().mockResolvedValue({}),
      prefetch: jest.fn().mockResolvedValue(undefined),
      consume: jest.fn().mockImplementation(async (_fila, onMessage) => {
        entregar = onMessage;
        return { consumerTag: "ctag" };
      }),
      ack: jest.fn(),
      nack: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    });
    connection = Object.assign(new EventEmitter(), {
      createChannel: jest.fn().mockResolvedValue(channel),
      close: jest.fn().mockResolvedValue(undefined),
    });
    processarEvento = jest.fn().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await consumidor?.encerrar();
    consumidor = undefined;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("declara a mesma topologia do servico-validacao e consome notificacao.alarmes com prefetch", async () => {
    await iniciar();

    expect(channel.assertExchange).toHaveBeenCalledWith(EXCHANGE_ALARME_DISPARADO, "fanout", { durable: true });
    expect(channel.assertQueue).toHaveBeenCalledWith(FILA_NOTIFICACAO_ALARMES, {
      durable: true,
      arguments: { "x-queue-type": "quorum", "x-delivery-limit": 3, "x-dead-letter-exchange": "notificacao.dlx" },
    });
    expect(channel.bindQueue).toHaveBeenCalledWith(FILA_NOTIFICACAO_DLQ, EXCHANGE_NOTIFICACAO_DLX, "");
    expect(ARGUMENTOS_FILA_NOTIFICACAO["x-delivery-limit"]).toBe(3);
    expect(channel.prefetch).toHaveBeenCalledWith(5);
    expect(channel.consume).toHaveBeenCalledWith(FILA_NOTIFICACAO_ALARMES, expect.any(Function), { noAck: false });
    expect(consumidor?.estaSaudavel()).toBe(true);
  });

  it("processa o evento válido e só então confirma", async () => {
    let terminar!: () => void;
    processarEvento.mockImplementation(() => new Promise<void>((resolve) => { terminar = resolve; }));
    await iniciar();
    const msg = mensagem(evento);

    entregar(msg);
    await esperarAte(() => processarEvento.mock.calls.length === 1);
    expect(channel.ack).not.toHaveBeenCalled();
    terminar();
    await esperarAte(() => channel.ack.mock.calls.length === 1);

    expect(processarEvento).toHaveBeenCalledWith(evento);
    expect(channel.ack).toHaveBeenCalledWith(msg);
  });

  it.each([
    ["texto que não é JSON", "não é json"],
    ["sem município", { ...evento, municipio: "" }],
    ["severidade desconhecida", { ...evento, severidade: "URGENTE" }],
    ["valor em número em vez de texto", { ...evento, valor: 52.3 }],
  ])("evento malformado (%s) vai para a DLQ sem processar nem tentar de novo", async (_caso, conteudo) => {
    await iniciar();
    const msg = mensagem(conteudo);

    entregar(msg);
    await esperarAte(() => channel.nack.mock.calls.length === 1);

    expect(channel.nack).toHaveBeenCalledWith(msg, false, false);
    expect(processarEvento).not.toHaveBeenCalled();
  });

  it("processamento que pede a DLQ rejeita sem devolver à fila", async () => {
    processarEvento.mockResolvedValue({ enviarParaDlq: true });
    await iniciar();
    const msg = mensagem(evento);

    entregar(msg);
    await esperarAte(() => channel.nack.mock.calls.length === 1);

    expect(channel.nack).toHaveBeenCalledWith(msg, false, false);
    expect(channel.ack).not.toHaveBeenCalled();
  });

  it("erro do próprio evento volta para a fila e conta no limite de entregas", async () => {
    processarEvento.mockRejectedValue(new Error("violação qualquer"));
    await iniciar();
    const msg = mensagem(evento);

    entregar(msg);
    await esperarAte(() => channel.nack.mock.calls.length === 1);

    expect(channel.nack).toHaveBeenCalledWith(msg, false, true);
  });

  it("com o banco fora do ar pausa o consumo e retoma quando ele responde", async () => {
    processarEvento.mockRejectedValueOnce(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }));
    let bancoNoAr = false;
    await iniciar({ verificarBanco: async () => bancoNoAr, esperaBancoMs: 5 });

    entregar(mensagem(evento));
    await esperarAte(() => consumidor?.estaComConsumoPausado() === true);
    expect(channel.close).toHaveBeenCalled();
    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).not.toHaveBeenCalled();

    bancoNoAr = true;
    await esperarAte(() => consumidor?.estaComConsumoPausado() === false && connection.createChannel.mock.calls.length === 2);
    expect(channel.consume).toHaveBeenCalledTimes(2);
  });

  it("lerEventoAlarme aceita o contrato do servico-validacao", () => {
    expect(lerEventoAlarme(JSON.stringify(evento))).toEqual(evento);
    expect(lerEventoAlarme("{}")).toBeNull();
  });
});
