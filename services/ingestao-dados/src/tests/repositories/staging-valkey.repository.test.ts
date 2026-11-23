import { valkey } from "../../config/valkey";
import {
  chaveMensagem,
  chaveVisto,
  descartarPendente,
  encerrarSemPublicar,
  expiraEm,
  gravarBruta,
  lerMensagem,
  lerMetricas,
  listarRecebidas,
  LISTA_PENDENTES,
  LISTA_RECEBIDAS,
  marcarEncaminhada,
  marcarPendente,
  marcarVisto,
  proximaPendente,
  RETENCAO_MS,
} from "../../repositories/staging-valkey.repository";
import { ESTACAO_DESCONHECIDA, MOTIVOS_REJEICAO, PAYLOAD_MALFORMADO } from "../../validations/motivos-rejeicao";

// Unitário: o cliente do Valkey é falso e registra os comandos de cada MULTI.
jest.mock("../../config/valkey");

type Comando = [string, ...unknown[]];

const AGORA = new Date("2026-11-16T10:00:00.000Z");
const SETE_DIAS_DEPOIS = new Date("2026-11-23T10:00:00.000Z");
const ESTACAO_UUID = "8723c462-e79c-4e58-9751-eef8868a5312";

let comandos: Comando[];
let cliente: Record<string, jest.Mock>;
let transacao: Record<string, jest.Mock>;

beforeEach(() => {
  comandos = [];
  transacao = {};
  for (const nome of ["hSet", "rPush", "lRem", "expireAt", "incr", "mGet", "lLen", "lIndex"]) {
    transacao[nome] = jest.fn((...args: unknown[]) => {
      comandos.push([nome, ...args]);
      return transacao;
    });
  }
  transacao.exec = jest.fn(async () => []);
  cliente = {
    multi: jest.fn(() => transacao),
    lIndex: jest.fn(async () => "id-da-frente"),
    lLen: jest.fn(async () => 3),
    lRange: jest.fn(async () => ["a", "b"]),
    lRem: jest.fn(async () => 1),
    hGetAll: jest.fn(async () => ({})),
    hGet: jest.fn(async (): Promise<string | undefined> => undefined),
    set: jest.fn(async (): Promise<string | null> => null),
  };
  jest.mocked(valkey).mockReturnValue(cliente as never);
});

describe("gravarBruta", () => {
  describe("US-40 · Cenário 1 · gravação antes de tudo", () => {
    it("deve gravar topico, conteúdo, recebidoEm e status recebida e entrar na fila de verificação quando a mensagem chega", async () => {
      // Dado (Arrange)
      const bruta = { topico: "pulso/estacoes/x/telemetria", payloadBruto: " {cru} ", recebidoEm: AGORA.toISOString() };

      // Quando (Act)
      const id = await gravarBruta(bruta);

      // Então (Assert)
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(comandos).toEqual([
        ["hSet", chaveMensagem(id), { topico: bruta.topico, conteudo: " {cru} ", recebidoEm: bruta.recebidoEm, status: "recebida" }],
        ["rPush", LISTA_RECEBIDAS, id],
        ["incr", "staging:contador:recebidas"],
      ]);
    });
  });
});

describe("listarRecebidas", () => {
  it("deve devolver a fila de verificação inteira, na ordem, quando é lida", async () => {
    // Dado (Arrange)
    // Quando (Act)
    const ids = await listarRecebidas();

    // Então (Assert)
    expect(ids).toEqual(["a", "b"]);
    expect(cliente.lRange).toHaveBeenCalledWith(LISTA_RECEBIDAS, 0, -1);
  });
});

describe("lerMensagem", () => {
  it("deve devolver a mensagem com conteudo em payloadBruto quando a chave existe", async () => {
    // Dado (Arrange)
    cliente.hGetAll.mockResolvedValue({
      topico: "t", conteudo: "c", recebidoEm: "r", status: "recusada", motivo: "m",
    });

    // Quando (Act)
    const mensagem = await lerMensagem("id-1");

    // Então (Assert)
    expect(mensagem).toEqual({ id: "id-1", topico: "t", payloadBruto: "c", recebidoEm: "r", status: "recusada", motivo: "m" });
    expect(cliente.hGetAll).toHaveBeenCalledWith(chaveMensagem("id-1"));
  });

  it("deve devolver null quando a chave não existe ou expirou", async () => {
    // Dado (Arrange)
    cliente.hGetAll.mockResolvedValue({});

    // Quando (Act)
    const mensagem = await lerMensagem("id-1");

    // Então (Assert)
    expect(mensagem).toBeNull();
  });
});

describe("encerrarSemPublicar", () => {
  describe("US-40 · Cenário 7 · expiração em 7 dias", () => {
    it.each(["recusada", "duplicada"] as const)(
      "deve expirar 7 dias depois do agora simulado e sair da fila de verificação quando a mensagem fica %s",
      async (status) => {
        // Dado (Arrange)
        // Quando (Act)
        await encerrarSemPublicar("id-1", status, AGORA);

        // Então (Assert)
        expect(comandos).toContainEqual(["expireAt", chaveMensagem("id-1"), SETE_DIAS_DEPOIS]);
        expect(comandos).toContainEqual(["lRem", LISTA_RECEBIDAS, 1, "id-1"]);
      },
    );
  });

  it("deve gravar o motivo junto com o status quando a mensagem é recusada", async () => {
    // Dado (Arrange)
    // Quando (Act)
    await encerrarSemPublicar("id-1", "recusada", AGORA, "Nível de bateria fora de 0 a 100");

    // Então (Assert)
    expect(comandos).toContainEqual([
      "hSet", chaveMensagem("id-1"), { status: "recusada", motivo: "Nível de bateria fora de 0 a 100" },
    ]);
  });

  it("deve gravar só o status, sem motivo, quando a mensagem é duplicada", async () => {
    // Dado (Arrange)
    // Quando (Act)
    await encerrarSemPublicar("id-1", "duplicada", AGORA);

    // Então (Assert)
    expect(comandos).toContainEqual(["hSet", chaveMensagem("id-1"), { status: "duplicada" }]);
  });

  describe("US-21 · contadores no mesmo MULTI", () => {
    it("deve somar em staging:contador:recusadas:{motivo} quando a mensagem é recusada", async () => {
      // Dado (Arrange)
      // Quando (Act)
      await encerrarSemPublicar("id-1", "recusada", AGORA, "Payload malformado");

      // Então (Assert)
      expect(comandos).toContainEqual(["incr", "staging:contador:recusadas:Payload malformado"]);
      expect(transacao.exec).toHaveBeenCalledTimes(1);
    });

    it("deve somar em staging:contador:duplicadas quando a mensagem é duplicada", async () => {
      // Dado (Arrange)
      // Quando (Act)
      await encerrarSemPublicar("id-1", "duplicada", AGORA);

      // Então (Assert)
      expect(comandos).toContainEqual(["incr", "staging:contador:duplicadas"]);
    });
  });
});

describe("marcarVisto", () => {
  const ESTACAO = "00000000-0000-4000-8000-00000000000a";
  const UNIXTIME = 1792400000;

  describe("US-13 · duplicata por estação e horário no Valkey", () => {
    it("deve devolver nova quando a chave staging:visto não existia", async () => {
      // Dado (Arrange)
      cliente.set.mockResolvedValue(null);

      // Quando (Act)
      const resultado = await marcarVisto(ESTACAO, UNIXTIME, "id-1", AGORA);

      // Então (Assert)
      expect(resultado).toBe("nova");
    });

    it("deve devolver nova quando a chave já guarda o mesmo id, porque é a mesma mensagem verificada de novo", async () => {
      // Dado (Arrange)
      cliente.set.mockResolvedValue("id-1");

      // Quando (Act)
      const resultado = await marcarVisto(ESTACAO, UNIXTIME, "id-1", AGORA);

      // Então (Assert)
      expect(resultado).toBe("nova");
    });

    it("deve devolver duplicada quando a chave guarda o id de outra mensagem", async () => {
      // Dado (Arrange)
      cliente.set.mockResolvedValue("id-original");

      // Quando (Act)
      const resultado = await marcarVisto(ESTACAO, UNIXTIME, "id-copia", AGORA);

      // Então (Assert)
      expect(resultado).toBe("duplicada");
    });

    it("deve usar SET NX GET com expiração 7 dias depois do agora quando marca a chave", async () => {
      // Dado (Arrange)
      // Quando (Act)
      await marcarVisto(ESTACAO, UNIXTIME, "id-1", AGORA);

      // Então (Assert)
      expect(cliente.set).toHaveBeenCalledWith(chaveVisto(ESTACAO, UNIXTIME), "id-1", {
        NX: true,
        GET: true,
        PXAT: SETE_DIAS_DEPOIS.getTime(),
      });
      expect(chaveVisto(ESTACAO, UNIXTIME)).toBe(`staging:visto:${ESTACAO}:${UNIXTIME}`);
    });

    it("deve propagar o erro quando o Valkey está fora", async () => {
      // Dado (Arrange)
      const erro = new Error("Valkey indisponível");
      cliente.set.mockRejectedValue(erro);

      // Quando (Act)
      const resultado = marcarVisto(ESTACAO, UNIXTIME, "id-1", AGORA);

      // Então (Assert)
      await expect(resultado).rejects.toBe(erro);
    });
  });
});

describe("marcarPendente", () => {
  it("deve entrar no fim de staging:pendentes, sair da verificação e não expirar quando a mensagem é aceita", async () => {
    // Dado (Arrange)
    // Quando (Act)
    await marcarPendente("id-1", ESTACAO_UUID);

    // Então (Assert)
    expect(comandos).toEqual([
      ["hSet", chaveMensagem("id-1"), { status: "pendente", estacao_id: ESTACAO_UUID }],
      ["rPush", LISTA_PENDENTES, "id-1"],
      ["lRem", LISTA_RECEBIDAS, 1, "id-1"],
    ]);
  });
});

describe("proximaPendente", () => {
  it("deve ler a frente da lista sem tirar quando busca a próxima a publicar", async () => {
    // Dado (Arrange)
    // Quando (Act)
    const id = await proximaPendente();

    // Então (Assert)
    expect(id).toBe("id-da-frente");
    expect(cliente.lIndex).toHaveBeenCalledWith(LISTA_PENDENTES, 0);
  });
});

describe("marcarEncaminhada", () => {
  describe("US-40 · Cenário 7 · expiração em 7 dias", () => {
    it("deve marcar encaminhada e expirar 7 dias depois do agora simulado quando o RabbitMQ confirma", async () => {
      // Dado (Arrange)
      // Quando (Act)
      await marcarEncaminhada("id-1", AGORA);

      // Então (Assert)
      expect(comandos).toContainEqual(["hSet", chaveMensagem("id-1"), { status: "encaminhada" }]);
      expect(comandos).toContainEqual(["expireAt", chaveMensagem("id-1"), SETE_DIAS_DEPOIS]);
    });
  });

  it("deve tirar da lista com LREM pelo id, e não com LPOP, quando marca encaminhada", async () => {
    // Dado (Arrange)
    // Quando (Act)
    await marcarEncaminhada("id-1", AGORA);

    // Então (Assert)
    expect(comandos).toContainEqual(["lRem", LISTA_PENDENTES, 1, "id-1"]);
    expect(cliente.lPop).toBeUndefined();
  });

  it("deve somar em staging:contador:encaminhadas no mesmo MULTI quando o RabbitMQ confirma", async () => {
    // Dado (Arrange)
    // Quando (Act)
    await marcarEncaminhada("id-1", AGORA);

    // Então (Assert)
    expect(comandos).toContainEqual(["incr", "staging:contador:encaminhadas"]);
    expect(transacao.exec).toHaveBeenCalledTimes(1);
  });
});

describe("descartarPendente", () => {
  it("deve tirar o id da lista pelo valor quando a mensagem não existe mais", async () => {
    // Dado (Arrange)
    // Quando (Act)
    await descartarPendente("id-1");

    // Então (Assert)
    expect(cliente.lRem).toHaveBeenCalledWith(LISTA_PENDENTES, 1, "id-1");
  });
});

describe("lerMetricas", () => {
  // MGET na ordem: recebidas, duplicadas, encaminhadas e uma por motivo de MOTIVOS_REJEICAO.
  const contadores = (recebidas: string | null, duplicadas: string | null, encaminhadas: string | null) =>
    [recebidas, duplicadas, encaminhadas, ...MOTIVOS_REJEICAO.map(() => null)] as Array<string | null>;

  it("deve devolver tudo zerado, recusadas {} e pendenteMaisAntigaEm null quando nenhum contador existe", async () => {
    // Dado (Arrange)
    transacao.exec.mockResolvedValue([contadores(null, null, null), 0, null]);

    // Quando (Act)
    const metricas = await lerMetricas();

    // Então (Assert)
    expect(metricas).toEqual({
      leiturasRecebidas: 0,
      leiturasRejeitadas: {},
      duplicadasIgnoradas: 0,
      mensagensPendentes: 0,
      mensagensEncaminhadas: 0,
      pendenteMaisAntigaEm: null,
    });
    expect(cliente.hGet).not.toHaveBeenCalled();
  });

  it("deve devolver cada contador, só os motivos com recusa e o recebidoEm da frente quando há de tudo", async () => {
    // Dado (Arrange)
    const valores = contadores("10", "1", "6");
    valores[3 + MOTIVOS_REJEICAO.indexOf(PAYLOAD_MALFORMADO)] = "2";
    valores[3 + MOTIVOS_REJEICAO.indexOf(ESTACAO_DESCONHECIDA)] = "1";
    transacao.exec.mockResolvedValue([valores, 1, "id-da-frente"]);
    cliente.hGet.mockResolvedValue("2026-11-16T09:59:00.000Z");

    // Quando (Act)
    const metricas = await lerMetricas();

    // Então (Assert)
    expect(metricas).toEqual({
      leiturasRecebidas: 10,
      leiturasRejeitadas: { [PAYLOAD_MALFORMADO]: 2, [ESTACAO_DESCONHECIDA]: 1 },
      duplicadasIgnoradas: 1,
      mensagensPendentes: 1,
      mensagensEncaminhadas: 6,
      pendenteMaisAntigaEm: "2026-11-16T09:59:00.000Z",
    });
    expect(cliente.hGet).toHaveBeenCalledWith(chaveMensagem("id-da-frente"), "recebidoEm");
  });

  it("deve ler contadores, tamanho e frente de staging:pendentes num MULTI só quando lê as métricas", async () => {
    // Dado (Arrange)
    transacao.exec.mockResolvedValue([contadores(null, null, null), 0, null]);

    // Quando (Act)
    await lerMetricas();

    // Então (Assert)
    expect(comandos).toEqual([
      ["mGet", [
        "staging:contador:recebidas",
        "staging:contador:duplicadas",
        "staging:contador:encaminhadas",
        ...MOTIVOS_REJEICAO.map((m) => `staging:contador:recusadas:${m}`),
      ]],
      ["lLen", LISTA_PENDENTES],
      ["lIndex", LISTA_PENDENTES, 0],
    ]);
  });

  it("deve devolver pendenteMaisAntigaEm null quando a da frente foi publicada entre as duas leituras", async () => {
    // Dado (Arrange)
    transacao.exec.mockResolvedValue([contadores("1", null, null), 1, "id-ja-publicado"]);
    cliente.hGet.mockResolvedValue(undefined);

    // Quando (Act)
    const metricas = await lerMetricas();

    // Então (Assert)
    expect(metricas.pendenteMaisAntigaEm).toBeNull();
  });

  it("deve propagar o erro quando o Valkey está fora", async () => {
    // Dado (Arrange)
    const erro = new Error("The client is offline");
    transacao.exec.mockRejectedValue(erro);

    // Quando (Act)
    const resultado = lerMetricas();

    // Então (Assert)
    await expect(resultado).rejects.toBe(erro);
  });
});

describe("expiraEm", () => {
  it("deve devolver a data 7 dias depois quando recebe o agora", () => {
    // Dado (Arrange)
    // Quando (Act)
    const data = expiraEm(AGORA);

    // Então (Assert)
    expect(data).toEqual(SETE_DIAS_DEPOIS);
    expect(RETENCAO_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
