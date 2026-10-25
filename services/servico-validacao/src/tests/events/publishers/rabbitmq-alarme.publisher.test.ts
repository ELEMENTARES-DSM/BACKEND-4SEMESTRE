import { EventEmitter } from "node:events";
import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { ChannelModel } from "amqplib";
import {
  ARGUMENTOS_FILA_NOTIFICACAO,
  EXCHANGE_ALARME_DISPARADO,
  EXCHANGE_NOTIFICACAO_DLX,
  FILA_NOTIFICACAO_ALARMES,
  FILA_NOTIFICACAO_DLQ,
  PublicadorAlarmes,
  declararTopologiaAlarmes,
  montarEventoAlarme,
} from "../../../events/publishers/rabbitmq-alarme.publisher";
import { AlarmeRow } from "../../../dto/alarme.dto";
import logger from "../../../utils/logger";

type MockAsync = jest.Mock<(...args: unknown[]) => Promise<unknown>>;

const alarme = (id = "alarme-1"): AlarmeRow => ({
  id,
  regra_id: "regra-1",
  medida_id: "medida-1",
  sensor_id: "sensor-1",
  estacao_id: "estacao-1",
  municipio: "São José dos Campos",
  valor: "52.300000",
  operador: ">=",
  limite: "50.00",
  severidade: "CRITICO",
  situacao: "aberto",
  lido_em: new Date("2026-10-24T13:00:00.000Z"),
  criado_em: new Date("2026-10-24T13:00:01.412Z"),
});

describe("rabbitmq-alarme.publisher (US-22)", () => {
  let canal: EventEmitter & {
    assertExchange: MockAsync;
    assertQueue: MockAsync;
    bindQueue: MockAsync;
    publish: jest.Mock;
    waitForConfirms: MockAsync;
    close: MockAsync;
  };
  let conexao: { createConfirmChannel: MockAsync };

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(logger, "error").mockImplementation(() => undefined);
    canal = Object.assign(new EventEmitter(), {
      assertExchange: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({}),
      assertQueue: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({}),
      bindQueue: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({}),
      publish: jest.fn(() => true),
      waitForConfirms: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined),
      close: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined),
    });
    conexao = { createConfirmChannel: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(canal) };
  });

  it("monta o evento em snake_case com valores decimais em texto e horários ISO", () => {
    expect(montarEventoAlarme(alarme())).toEqual({
      alarme_id: "alarme-1",
      regra_id: "regra-1",
      medida_id: "medida-1",
      sensor_id: "sensor-1",
      estacao_id: "estacao-1",
      municipio: "São José dos Campos",
      valor: "52.300000",
      operador: ">=",
      limite: "50.00",
      severidade: "CRITICO",
      lido_em: "2026-10-24T13:00:00.000Z",
      criado_em: "2026-10-24T13:00:01.412Z",
    });
  });

  it("declara exchange, fila quorum com limite de 3 entregas, DLX e DLQ", async () => {
    await declararTopologiaAlarmes(canal as never);

    expect(canal.assertExchange).toHaveBeenCalledWith(EXCHANGE_ALARME_DISPARADO, "fanout", { durable: true });
    expect(canal.assertExchange).toHaveBeenCalledWith(EXCHANGE_NOTIFICACAO_DLX, "fanout", { durable: true });
    expect(canal.assertQueue).toHaveBeenCalledWith(FILA_NOTIFICACAO_ALARMES, {
      durable: true,
      arguments: {
        "x-queue-type": "quorum",
        "x-delivery-limit": 3,
        "x-dead-letter-exchange": "notificacao.dlx",
      },
    });
    expect(canal.bindQueue).toHaveBeenCalledWith(FILA_NOTIFICACAO_ALARMES, EXCHANGE_ALARME_DISPARADO, "");
    expect(canal.assertQueue).toHaveBeenCalledWith(FILA_NOTIFICACAO_DLQ, { durable: true });
    expect(canal.bindQueue).toHaveBeenCalledWith(FILA_NOTIFICACAO_DLQ, EXCHANGE_NOTIFICACAO_DLX, "");
    expect(ARGUMENTOS_FILA_NOTIFICACAO["x-dead-letter-exchange"]).toBe(EXCHANGE_NOTIFICACAO_DLX);
  });

  it("publica cada alarme persistente, com messageId igual ao id, e espera a confirmação", async () => {
    const publicador = new PublicadorAlarmes(() => conexao as unknown as ChannelModel);

    await publicador.publicar([alarme("a-1"), alarme("a-2")]);

    expect(canal.publish).toHaveBeenCalledTimes(2);
    const [exchange, rota, corpo, opcoes] = canal.publish.mock.calls[0] as [string, string, Buffer, Record<string, unknown>];
    expect([exchange, rota]).toEqual([EXCHANGE_ALARME_DISPARADO, ""]);
    expect(JSON.parse(corpo.toString("utf-8")).alarme_id).toBe("a-1");
    expect(opcoes).toEqual({ persistent: true, contentType: "application/json", messageId: "a-1" });
    expect(canal.waitForConfirms).toHaveBeenCalledTimes(1);
  });

  it("abre e declara o canal uma vez só e reaproveita nas publicações seguintes", async () => {
    const publicador = new PublicadorAlarmes(() => conexao as unknown as ChannelModel);

    await publicador.publicar([alarme("a-1")]);
    await publicador.publicar([alarme("a-2")]);

    expect(conexao.createConfirmChannel).toHaveBeenCalledTimes(1);
    expect(canal.assertQueue).toHaveBeenCalledTimes(2);
  });

  it("sem alarmes não abre canal", async () => {
    const publicador = new PublicadorAlarmes(() => conexao as unknown as ChannelModel);

    await publicador.publicar([]);

    expect(conexao.createConfirmChannel).not.toHaveBeenCalled();
  });

  it("falha quando não há conexão e quando o RabbitMQ não confirma", async () => {
    await expect(new PublicadorAlarmes(() => undefined).publicar([alarme()])).rejects.toThrow(
      "Sem conexão com o RabbitMQ para publicar alarmes",
    );

    canal.waitForConfirms.mockRejectedValueOnce(new Error("nack"));
    await expect(new PublicadorAlarmes(() => conexao as unknown as ChannelModel).publicar([alarme()])).rejects.toThrow("nack");
  });

  it("depois de descartarCanal abre um canal novo", async () => {
    const publicador = new PublicadorAlarmes(() => conexao as unknown as ChannelModel);

    await publicador.publicar([alarme("a-1")]);
    publicador.descartarCanal();
    await publicador.publicar([alarme("a-2")]);

    expect(conexao.createConfirmChannel).toHaveBeenCalledTimes(2);
  });
});
