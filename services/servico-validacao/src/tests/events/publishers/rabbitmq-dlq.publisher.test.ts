import { EventEmitter } from "node:events";
import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { ChannelModel } from "amqplib";
import {
  EXCHANGE_VALIDACAO_DLX,
  PublicadorDlqValidacao,
} from "../../../events/publishers/rabbitmq-dlq.publisher";
import { EventoRecusadoDTO } from "../../../dto/evento-telemetria.dto";

type MockAsync = jest.Mock<(...args: unknown[]) => Promise<unknown>>;

describe("PublicadorDlqValidacao", () => {
  let canal: EventEmitter & {
    publish: jest.Mock;
    waitForConfirms: MockAsync;
    checkExchange: MockAsync;
    close: MockAsync;
  };
  let conexao: { createConfirmChannel: MockAsync };

  const recusa = (sensor: string): EventoRecusadoDTO => ({
    staging_id: "staging-1",
    estacao_uuid: "estacao-1",
    unixtime: 1792400000,
    leituras: [{ sensor, valor: 7 }],
    motivo: "Sensor inexistente na estação",
    recusado_em: "2026-10-20T14:05:08.000Z",
  });

  const criarCanal = () =>
    Object.assign(new EventEmitter(), {
      publish: jest.fn(() => true),
      waitForConfirms: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined),
      checkExchange: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({}),
      close: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined),
    });

  const publicador = () =>
    new PublicadorDlqValidacao(() => conexao as unknown as ChannelModel);

  beforeEach(() => {
    canal = criarCanal();
    conexao = {
      createConfirmChannel: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(canal),
    };
  });

  it("publica cada evento na validacao.dlx como JSON persistente e espera a confirmação", async () => {
    await publicador().publicar([recusa("X-98"), recusa("X-99")]);

    expect(canal.checkExchange).toHaveBeenCalledWith(EXCHANGE_VALIDACAO_DLX);
    expect(canal.publish).toHaveBeenCalledTimes(2);
    const [exchange, rota, corpo, opcoes] = canal.publish.mock.calls[0] as [string, string, Buffer, object];
    expect(exchange).toBe("validacao.dlx");
    expect(rota).toBe("");
    expect(JSON.parse(corpo.toString("utf-8"))).toEqual(recusa("X-98"));
    expect(opcoes).toEqual({
      persistent: true,
      contentType: "application/json",
      messageId: "staging-1",
    });
    expect(canal.waitForConfirms).toHaveBeenCalledTimes(1);
  });

  it("lista vazia não abre canal", async () => {
    await publicador().publicar([]);

    expect(conexao.createConfirmChannel).not.toHaveBeenCalled();
  });

  it("reaproveita o canal entre publicações", async () => {
    const dlq = publicador();
    await dlq.publicar([recusa("X-98")]);
    await dlq.publicar([recusa("X-99")]);

    expect(conexao.createConfirmChannel).toHaveBeenCalledTimes(1);
  });

  it("rejeita quando o RabbitMQ não confirma", async () => {
    canal.waitForConfirms.mockRejectedValue(new Error("nack"));

    await expect(publicador().publicar([recusa("X-99")])).rejects.toThrow("nack");
  });

  it("rejeita quando não há conexão com o RabbitMQ", async () => {
    const semConexao = new PublicadorDlqValidacao(() => undefined);

    await expect(semConexao.publicar([recusa("X-99")])).rejects.toThrow(
      "Sem conexão com o RabbitMQ para publicar na DLQ",
    );
  });

  it("rejeita quando a exchange validacao.dlx não existe", async () => {
    canal.checkExchange.mockRejectedValue(new Error("NOT_FOUND - no exchange 'validacao.dlx'"));

    await expect(publicador().publicar([recusa("X-99")])).rejects.toThrow("NOT_FOUND");
    expect(canal.publish).not.toHaveBeenCalled();
  });

  it("abre um canal novo depois que o anterior fecha", async () => {
    const dlq = publicador();
    await dlq.publicar([recusa("X-98")]);

    const novoCanal = criarCanal();
    conexao.createConfirmChannel.mockResolvedValue(novoCanal);
    canal.emit("close");
    await dlq.publicar([recusa("X-99")]);

    expect(conexao.createConfirmChannel).toHaveBeenCalledTimes(2);
    expect(novoCanal.publish).toHaveBeenCalledTimes(1);
  });

  it("descartarCanal fecha o canal atual e a próxima publicação abre outro", async () => {
    const dlq = publicador();
    await dlq.publicar([recusa("X-98")]);

    dlq.descartarCanal();
    await dlq.publicar([recusa("X-99")]);

    expect(canal.close).toHaveBeenCalledTimes(1);
    expect(conexao.createConfirmChannel).toHaveBeenCalledTimes(2);
  });
});
