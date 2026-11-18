import { EventEmitter } from "node:events";
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import {
  descartarPendente,
  lerMensagem,
  marcarEncaminhada,
  MensagemStaging,
  proximaPendente,
} from "../../../repositories/staging-valkey.repository";
import { montarEvento, RabbitMqTelemetriaPublisher } from "../../../events/publishers/rabbitmq-telemetria.publisher";

// Unitário: Valkey (repository), RabbitMQ (conexão e canal falsos) e relógio mockados.
jest.mock("../../../repositories/staging-valkey.repository");

const ESTACAO = "8723c462-e79c-4e58-9751-eef8868a5312";
const AGORA = new Date("2026-11-16T10:00:00.000Z");

function mensagem(id: string, valor = 23): MensagemStaging {
  return {
    id,
    topico: `pulso/estacoes/${ESTACAO}/telemetria`,
    payloadBruto: `{"timestamp":"2026-11-16T09:59:00Z","nivel_bateria":80,"leituras":[{"sensor":"TMP","valor":${valor},"extra":1}]}`,
    recebidoEm: "2026-11-16T09:59:01.000Z",
    status: "pendente",
  };
}

type MockAsync = jest.Mock<(...args: unknown[]) => Promise<unknown>>;
type Publicar = (exchange: string, chave: string, conteudo: Buffer, opcoes: unknown, callback: (erro?: Error | null) => void) => boolean;
type MockChannel = EventEmitter & {
  assertExchange: MockAsync;
  assertQueue: MockAsync;
  bindQueue: MockAsync;
  close: MockAsync;
  publish: jest.Mock<Publicar>;
};

describe("montarEvento", () => {
  it("deve montar staging_id, estação do tópico, unixtime e só sensor e valor das leituras quando recebe a mensagem do Valkey", () => {
    // Dado (Arrange)
    const pendente = mensagem("id-1");

    // Quando (Act)
    const evento = montarEvento(pendente);

    // Então (Assert)
    expect(evento).toEqual({
      staging_id: "id-1",
      estacao_uuid: ESTACAO,
      unixtime: Date.parse("2026-11-16T09:59:00Z") / 1000,
      recebidoEm: "2026-11-16T09:59:01.000Z",
      leituras: [{ sensor: "TMP", valor: 23 }],
    });
  });
});

describe("RabbitMqTelemetriaPublisher", () => {
  let channel: MockChannel;
  let conectar: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  let publisher: RabbitMqTelemetriaPublisher;
  // Simula staging:pendentes: a frente é o índice 0 e a saída é pelo id (LREM).
  let fila: string[];
  let mensagens: Map<string, MensagemStaging>;

  const publicadas = (): Array<Record<string, unknown>> =>
    channel.publish.mock.calls.map(([, , conteudo]) => JSON.parse(conteudo.toString()));

  const aguardar = async (predicado: () => boolean, timeoutMs = 2000): Promise<void> => {
    const limite = Date.now() + timeoutMs;
    while (!predicado() && Date.now() < limite) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };

  const confirmarTudo = (): void => {
    channel.publish.mockImplementation((_e, _k, _c, _o, callback) => {
      callback(null);
      return true;
    });
  };

  function enfileirar(...lista: MensagemStaging[]): void {
    for (const m of lista) {
      fila.push(m.id);
      mensagens.set(m.id, m);
    }
  }

  // Conecta com a lista vazia e espera a rodada automática da conexão terminar,
  // para o teste chamar processarPendentes sozinho.
  async function conectarSemPendentes(): Promise<void> {
    await publisher.iniciar();
    await aguardar(() => jest.mocked(proximaPendente).mock.calls.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    jest.mocked(proximaPendente).mockClear();
  }

  beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    fila = [];
    mensagens = new Map();
    jest.mocked(proximaPendente).mockImplementation(async () => fila[0] ?? null);
    jest.mocked(lerMensagem).mockImplementation(async (id) => mensagens.get(id) ?? null);
    jest.mocked(marcarEncaminhada).mockImplementation(async (id) => {
      fila.splice(fila.indexOf(id), 1);
    });
    jest.mocked(descartarPendente).mockImplementation(async (id) => {
      fila.splice(fila.indexOf(id), 1);
    });

    channel = Object.assign(new EventEmitter(), {
      assertExchange: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined),
      assertQueue: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined),
      bindQueue: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined),
      close: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined),
      publish: jest.fn<Publicar>(),
    }) as MockChannel;
    const connection = Object.assign(new EventEmitter(), {
      close: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined),
      createConfirmChannel: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(channel),
    });
    conectar = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(connection);
    publisher = new RabbitMqTelemetriaPublisher({ url: "amqp://test", conectar: conectar as never, agora: () => AGORA });
  });

  afterEach(async () => {
    await publisher.encerrar();
    jest.restoreAllMocks();
  });

  describe("iniciar", () => {
    it("deve publicar as pendentes que já estavam na lista quando conecta ao RabbitMQ", async () => {
      // Dado (Arrange)
      enfileirar(mensagem("a"), mensagem("b"));
      confirmarTudo();

      // Quando (Act)
      await publisher.iniciar();
      await aguardar(() => fila.length === 0);

      // Então (Assert)
      expect(publicadas().map((e) => e.staging_id)).toEqual(["a", "b"]);
    });

    describe("US-40 · Cenário 3 · fila fora do ar", () => {
      it("deve manter as pendentes na lista sem ler o Valkey quando a conexão com o RabbitMQ falha", async () => {
        // Dado (Arrange)
        enfileirar(mensagem("a"));
        conectar.mockRejectedValue(new Error("ECONNREFUSED"));

        // Quando (Act)
        await publisher.iniciar();

        // Então (Assert)
        expect(proximaPendente).not.toHaveBeenCalled();
        expect(channel.publish).not.toHaveBeenCalled();
        expect(fila).toEqual(["a"]);
      });
    });
  });

  describe("processarPendentes", () => {
    describe("US-40 · publicação a partir de staging:pendentes", () => {
      it("deve publicar com staging_id igual ao id do Valkey e as opções de entrega quando há uma pendente", async () => {
        // Dado (Arrange)
        await conectarSemPendentes();
        enfileirar(mensagem("id-1"));
        confirmarTudo();

        // Quando (Act)
        await publisher.processarPendentes();

        // Então (Assert)
        expect(publicadas()).toEqual([montarEvento(mensagem("id-1"))]);
        expect(channel.publish.mock.calls[0][3]).toMatchObject({ persistent: true, mandatory: true, messageId: "id-1" });
      });

      it("deve publicar na ordem da lista quando há várias pendentes", async () => {
        // Dado (Arrange)
        await conectarSemPendentes();
        enfileirar(mensagem("a"), mensagem("b"), mensagem("c"));
        confirmarTudo();

        // Quando (Act)
        await publisher.processarPendentes();

        // Então (Assert)
        expect(publicadas().map((e) => e.staging_id)).toEqual(["a", "b", "c"]);
      });

      it("deve marcar encaminhada pelo id confirmado, com o agora injetado, quando o RabbitMQ confirma", async () => {
        // Dado (Arrange)
        await conectarSemPendentes();
        enfileirar(mensagem("a"), mensagem("b"));
        confirmarTudo();

        // Quando (Act)
        await publisher.processarPendentes();

        // Então (Assert)
        expect(jest.mocked(marcarEncaminhada).mock.calls).toEqual([["a", AGORA], ["b", AGORA]]);
      });

      it("deve marcar encaminhada só depois da confirmação quando o RabbitMQ demora a confirmar", async () => {
        // Dado (Arrange)
        await conectarSemPendentes();
        enfileirar(mensagem("a"));
        let confirmar!: () => void;
        channel.publish.mockImplementation((_e, _k, _c, _o, callback) => {
          confirmar = () => callback(null);
          return true;
        });

        // Quando (Act)
        const rodada = publisher.processarPendentes();
        await aguardar(() => channel.publish.mock.calls.length === 1);
        const antesDaConfirmacao = jest.mocked(marcarEncaminhada).mock.calls.length;
        confirmar();
        await rodada;

        // Então (Assert)
        expect(antesDaConfirmacao).toBe(0);
        expect(marcarEncaminhada).toHaveBeenCalledWith("a", AGORA);
      });

      it("deve parar a rodada e manter a mensagem na frente da lista quando o RabbitMQ rejeita a confirmação", async () => {
        // Dado (Arrange)
        await conectarSemPendentes();
        enfileirar(mensagem("a"), mensagem("b"));
        channel.publish.mockImplementation((_e, _k, _c, _o, callback) => {
          callback(new Error("nack"));
          return true;
        });

        // Quando (Act)
        await publisher.processarPendentes();

        // Então (Assert)
        expect(channel.publish).toHaveBeenCalledTimes(1);
        expect(marcarEncaminhada).not.toHaveBeenCalled();
        expect(fila).toEqual(["a", "b"]);
      });

      it("deve não marcar encaminhada quando mandatory é devolvida sem rota, mesmo com confirmação positiva", async () => {
        // Dado (Arrange)
        await conectarSemPendentes();
        enfileirar(mensagem("a"));
        channel.publish.mockImplementation((_e, _k, _c, _o, callback) => {
          channel.emit("return", { fields: { replyCode: 312, replyText: "NO_ROUTE" } });
          callback(null);
          return true;
        });

        // Quando (Act)
        await publisher.processarPendentes();

        // Então (Assert)
        expect(marcarEncaminhada).not.toHaveBeenCalled();
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining("NO_ROUTE"));
        expect(fila).toEqual(["a"]);
      });

      it("deve tirar da lista e seguir para a próxima quando o id não tem mensagem no Valkey", async () => {
        // Dado (Arrange)
        await conectarSemPendentes();
        fila.push("sem-mensagem");
        enfileirar(mensagem("b"));
        confirmarTudo();

        // Quando (Act)
        await publisher.processarPendentes();

        // Então (Assert)
        expect(descartarPendente).toHaveBeenCalledWith("sem-mensagem");
        expect(publicadas().map((e) => e.staging_id)).toEqual(["b"]);
      });
    });

    describe("US-40 · uma rodada de publicação por vez", () => {
      it("deve ter no máximo uma rodada ativa quando chegam vários pedidos ao mesmo tempo", async () => {
        // Dado (Arrange)
        await conectarSemPendentes();
        let ativas = 0;
        let maximo = 0;
        let liberar!: () => void;
        const travada = new Promise<void>((resolve) => { liberar = resolve; });
        jest.mocked(proximaPendente).mockImplementation(async () => {
          ativas += 1;
          maximo = Math.max(maximo, ativas);
          await travada;
          ativas -= 1;
          return null;
        });

        // Quando (Act)
        const primeira = publisher.processarPendentes();
        await Promise.all([publisher.processarPendentes(), publisher.processarPendentes()]);
        liberar();
        await primeira;

        // Então (Assert)
        expect(maximo).toBe(1);
        // A rodada do primeiro pedido e uma única rodada extra pelos outros dois.
        expect(proximaPendente).toHaveBeenCalledTimes(2);
      });

      it("deve fazer outra rodada quando um pedido chega durante a rodada atual", async () => {
        // Dado (Arrange)
        await conectarSemPendentes();
        confirmarTudo();
        let liberar!: () => void;
        const travada = new Promise<void>((resolve) => { liberar = resolve; });
        jest.mocked(proximaPendente)
          .mockImplementationOnce(async () => { await travada; return null; })
          .mockImplementation(async () => fila[0] ?? null);

        // Quando (Act)
        const primeira = publisher.processarPendentes();
        enfileirar(mensagem("chegou-durante"));
        await publisher.processarPendentes();
        liberar();
        await primeira;

        // Então (Assert)
        expect(publicadas().map((e) => e.staging_id)).toEqual(["chegou-durante"]);
      });
    });

    describe("US-40 · Cenário 3 · fila fora do ar", () => {
      it("deve não ler o Valkey quando não há canal com o RabbitMQ", async () => {
        // Dado (Arrange)
        enfileirar(mensagem("a"));
        conectar.mockRejectedValue(new Error("ECONNREFUSED"));
        await publisher.iniciar();

        // Quando (Act)
        await publisher.processarPendentes();

        // Então (Assert)
        expect(proximaPendente).not.toHaveBeenCalled();
        expect(fila).toEqual(["a"]);
      });

      it("deve registrar no log e não lançar quando o Valkey falha ao ler as pendentes", async () => {
        // Dado (Arrange)
        await conectarSemPendentes();
        jest.mocked(proximaPendente).mockRejectedValue(new Error("The client is offline"));

        // Quando (Act)
        const resultado = publisher.processarPendentes();

        // Então (Assert)
        await expect(resultado).resolves.toBeUndefined();
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining("The client is offline"));
      });
    });
  });
});
