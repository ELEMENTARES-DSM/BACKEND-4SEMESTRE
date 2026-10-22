import { EventEmitter } from "node:events";
import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { ChannelModel, GetMessage } from "amqplib";
import {
  ajustarFormatoParaReenvio,
  RabbitMqIndisponivelError,
  reenviarEventosDlq,
} from "../../services/reenvio-dlq.service";
import logger from "../../utils/logger";

type MockAsync = jest.Mock<(...args: unknown[]) => Promise<unknown>>;

const evento = {
  staging_id: "staging-1",
  estacao_uuid: "estacao-1",
  unixtime: 1792400000,
  leituras: [{ sensor: "X-99", valor: 7 }],
};

const json = (valor: unknown) => Buffer.from(JSON.stringify(valor));
const ler = (buffer: Buffer) => JSON.parse(buffer.toString("utf-8"));

describe("ajustarFormatoParaReenvio (TASK 20.03)", () => {
  it("evento do limite de entregas volta como está", () => {
    const original = json(evento);
    expect(ajustarFormatoParaReenvio(original)).toBe(original);
  });

  it("leitura recusada da US-18 perde motivo e recusado_em", () => {
    const recusa = { ...evento, motivo: "Sensor inexistente na estação", recusado_em: "2026-10-20T14:05:08.000Z" };
    expect(ler(ajustarFormatoParaReenvio(json(recusa)))).toEqual(evento);
  });

  it("evento malformado volta com o conteúdo original guardado em leituras", () => {
    const original = { staging_id: "staging-2", estacao_uuid: "estacao-1", unixtime: 1792400300 };
    const recusa = {
      staging_id: "staging-2",
      estacao_uuid: "estacao-1",
      unixtime: 1792400300,
      leituras: original,
      motivo: "Evento malformado",
      recusado_em: "2026-10-20T14:05:08.000Z",
    };
    expect(ler(ajustarFormatoParaReenvio(json(recusa)))).toEqual(original);
  });

  it("evento malformado que não era JSON volta como o texto original", () => {
    const recusa = { staging_id: null, leituras: "não é json", motivo: "Evento malformado" };
    expect(ajustarFormatoParaReenvio(json(recusa)).toString("utf-8")).toBe("não é json");
  });

  it("conteúdo que não é JSON volta sem alteração", () => {
    const original = Buffer.from("texto");
    expect(ajustarFormatoParaReenvio(original)).toBe(original);
  });
});

describe("reenviarEventosDlq (TASK 20.03)", () => {
  let canal: EventEmitter & {
    checkQueue: MockAsync;
    get: MockAsync;
    sendToQueue: jest.Mock;
    waitForConfirms: MockAsync;
    ack: jest.Mock;
    nack: jest.Mock;
    close: MockAsync;
  };
  let conexao: EventEmitter & { createConfirmChannel: MockAsync; close: MockAsync };
  let dlq: GetMessage[];
  let tamanhoInicial: number;

  const mensagem = (corpo: unknown, id: string): GetMessage =>
    ({ content: json(corpo), fields: {}, properties: { messageId: id } }) as unknown as GetMessage;

  const reenviar = (quantidade?: number) =>
    reenviarEventosDlq(quantidade, {
      url: "amqp://teste",
      conectar: (async () => conexao as unknown as ChannelModel) as never,
    });

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation(() => undefined);
    dlq = [mensagem(evento, "a"), mensagem(evento, "b"), mensagem(evento, "c")];
    tamanhoInicial = dlq.length;
    canal = Object.assign(new EventEmitter(), {
      checkQueue: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockImplementation(async (fila) =>
        fila === "validacao.dlq" ? { messageCount: dlq.length } : { messageCount: 0 },
      ),
      get: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockImplementation(async () => dlq.shift() ?? false),
      sendToQueue: jest.fn(() => true),
      waitForConfirms: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined),
      ack: jest.fn(),
      nack: jest.fn(),
      close: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined),
    });
    conexao = Object.assign(new EventEmitter(), {
      createConfirmChannel: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(canal),
      close: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined),
    });
  });

  it("sem quantidade reenvia todos, um a um, com confirmação antes de tirar da DLQ", async () => {
    const ordem: string[] = [];
    canal.waitForConfirms.mockImplementation(async () => {
      ordem.push("confirmado");
    });
    canal.ack.mockImplementation(() => ordem.push("removido da DLQ"));

    await expect(reenviar()).resolves.toEqual({ reenviados: 3, restantes: 0 });

    expect(canal.sendToQueue).toHaveBeenCalledTimes(3);
    expect(canal.sendToQueue).toHaveBeenCalledWith(
      "validacao.telemetria",
      expect.any(Buffer),
      { persistent: true, contentType: "application/json", messageId: "a" },
    );
    expect(ordem).toEqual([
      "confirmado", "removido da DLQ",
      "confirmado", "removido da DLQ",
      "confirmado", "removido da DLQ",
    ]);
    expect(conexao.close).toHaveBeenCalled();
  });

  it("com quantidade reenvia só os mais antigos e informa os restantes", async () => {
    await expect(reenviar(2)).resolves.toEqual({ reenviados: 2, restantes: 1 });
    expect(canal.sendToQueue.mock.calls.map(([, , opcoes]) => (opcoes as { messageId: string }).messageId))
      .toEqual(["a", "b"]);
  });

  it("não passa do número de eventos que havia na DLQ no início da chamada", async () => {
    // Cada evento reenviado volta para o fim da DLQ, como uma leitura ainda recusada.
    canal.ack.mockImplementation((msg) => {
      dlq.push(msg as GetMessage);
    });

    const resultado = await reenviar();

    expect(resultado.reenviados).toBe(tamanhoInicial);
    expect(canal.get).toHaveBeenCalledTimes(tamanhoInicial);
  });

  it("DLQ vazia responde reenviados 0 e restantes 0", async () => {
    dlq = [];
    await expect(reenviar()).resolves.toEqual({ reenviados: 0, restantes: 0 });
    expect(canal.get).not.toHaveBeenCalled();
  });

  it("publicação sem confirmação devolve o evento à DLQ e interrompe o reenvio", async () => {
    canal.waitForConfirms
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("channel closed"));

    const falha = reenviar();

    await expect(falha).rejects.toBeInstanceOf(RabbitMqIndisponivelError);
    await expect(falha).rejects.toMatchObject({ reenviados: 1 });
    expect(canal.ack).toHaveBeenCalledTimes(1);
    expect(canal.nack).toHaveBeenCalledWith(expect.anything(), false, true);
    expect(canal.sendToQueue).toHaveBeenCalledTimes(2);
    expect(conexao.close).toHaveBeenCalled();
  });

  it("sem conexão com o RabbitMQ lança RabbitMqIndisponivelError sem reenviar nada", async () => {
    const falha = reenviarEventosDlq(undefined, {
      url: "amqp://teste",
      conectar: (async () => {
        throw new Error("connect ECONNREFUSED");
      }) as never,
    });

    await expect(falha).rejects.toBeInstanceOf(RabbitMqIndisponivelError);
    await expect(falha).rejects.toMatchObject({ reenviados: 0, message: "connect ECONNREFUSED" });
  });

  it("fila principal ausente interrompe antes de tirar qualquer evento da DLQ", async () => {
    canal.checkQueue.mockImplementation(async (fila) => {
      if (fila === "validacao.telemetria") throw new Error("NOT_FOUND - no queue");
      return { messageCount: dlq.length };
    });

    await expect(reenviar()).rejects.toBeInstanceOf(RabbitMqIndisponivelError);
    expect(canal.get).not.toHaveBeenCalled();
  });
});
