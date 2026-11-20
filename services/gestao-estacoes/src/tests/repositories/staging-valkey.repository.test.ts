import { valkey } from "../../config/valkey";
import {
  listarMensagensVerificadas,
  PADRAO_MENSAGENS,
} from "../../repositories/staging-valkey.repository";

// Unitário: o cliente do Valkey é falso. A leitura real fica no teste de integração.
jest.mock("../../config/valkey", () => ({ valkey: jest.fn() }));

const ESTACAO = "11111111-1111-4111-8111-111111111111";
const OUTRA = "22222222-2222-4222-8222-222222222222";
const topicoDe = (id: string) => `pulso/estacoes/${id}/telemetria`;

type Hash = Record<string, string>;

let hashes: Record<string, Hash>;
let rodadas: { cursor: number; keys: string[] }[];
let cliente: { scan: jest.Mock; hmGet: jest.Mock };

const mensagem = (topico: string, status: string, conteudo = "{}"): Hash => ({
  topico,
  status,
  conteudo,
  recebidoEm: "2026-11-17T10:00:00.000Z",
});

beforeEach(() => {
  hashes = {};
  rodadas = [];
  cliente = {
    scan: jest.fn(async () => rodadas.shift() ?? { cursor: 0, keys: [] }),
    hmGet: jest.fn(async (chave: string, campos: string[]) =>
      campos.map((campo) => hashes[chave]?.[campo] ?? null)
    ),
  };
  jest.mocked(valkey).mockResolvedValue(cliente as never);
});

describe("staging-valkey.repository: listarMensagensVerificadas (US-39)", () => {
  it("deve varrer só as chaves das mensagens do staging, com SCAN", async () => {
    // Quando
    await listarMensagensVerificadas(ESTACAO);

    // Então
    expect(cliente.scan).toHaveBeenCalledWith(0, expect.objectContaining({ MATCH: PADRAO_MENSAGENS }));
    expect(PADRAO_MENSAGENS).toBe("staging:msg:*");
  });

  it("deve devolver só as mensagens verificadas da estação, com o payload e a hora de chegada", async () => {
    // Dado
    hashes = {
      "staging:msg:a": mensagem(topicoDe(ESTACAO), "encaminhada", '{"a":1}'),
      "staging:msg:b": mensagem(topicoDe(ESTACAO), "pendente", '{"b":2}'),
      "staging:msg:c": mensagem(topicoDe(OUTRA), "encaminhada"),
    };
    rodadas = [{ cursor: 0, keys: ["staging:msg:a", "staging:msg:b", "staging:msg:c"] }];

    // Quando
    const mensagens = await listarMensagensVerificadas(ESTACAO);

    // Então
    expect(mensagens).toEqual([
      { payloadBruto: '{"a":1}', recebidoEm: "2026-11-17T10:00:00.000Z" },
      { payloadBruto: '{"b":2}', recebidoEm: "2026-11-17T10:00:00.000Z" },
    ]);
  });

  it.each(["recebida", "recusada", "duplicada"])(
    "deve ignorar a mensagem com status %s",
    async (status) => {
      // Dado
      hashes = { "staging:msg:a": mensagem(topicoDe(ESTACAO), status) };
      rodadas = [{ cursor: 0, keys: ["staging:msg:a"] }];

      // Quando / Então
      await expect(listarMensagensVerificadas(ESTACAO)).resolves.toEqual([]);
    }
  );

  it("deve aceitar o UUID do tópico em maiúsculas, como a ingestão aceita", async () => {
    // Dado
    hashes = { "staging:msg:a": mensagem(topicoDe(ESTACAO.toUpperCase()), "encaminhada") };
    rodadas = [{ cursor: 0, keys: ["staging:msg:a"] }];

    // Quando
    const mensagens = await listarMensagensVerificadas(ESTACAO);

    // Então
    expect(mensagens).toHaveLength(1);
  });

  it("deve trazer o payload só das mensagens da estação pedida", async () => {
    // Dado
    hashes = {
      "staging:msg:a": mensagem(topicoDe(ESTACAO), "encaminhada"),
      "staging:msg:c": mensagem(topicoDe(OUTRA), "encaminhada"),
    };
    rodadas = [{ cursor: 0, keys: ["staging:msg:a", "staging:msg:c"] }];

    // Quando
    await listarMensagensVerificadas(ESTACAO);

    // Então
    const leituras = cliente.hmGet.mock.calls.filter(([, campos]) => campos.includes("conteudo"));
    expect(leituras.map(([chave]) => chave)).toEqual(["staging:msg:a"]);
  });

  it("deve seguir o cursor do SCAN até ele voltar a zero", async () => {
    // Dado
    hashes = {
      "staging:msg:a": mensagem(topicoDe(ESTACAO), "encaminhada", '{"a":1}'),
      "staging:msg:b": mensagem(topicoDe(ESTACAO), "encaminhada", '{"b":2}'),
    };
    rodadas = [
      { cursor: 17, keys: ["staging:msg:a"] },
      { cursor: 0, keys: ["staging:msg:b"] },
    ];

    // Quando
    const mensagens = await listarMensagensVerificadas(ESTACAO);

    // Então
    expect(cliente.scan.mock.calls.map(([cursor]) => cursor)).toEqual([0, 17]);
    expect(mensagens).toHaveLength(2);
  });

  it("deve contar uma vez a chave que o SCAN devolve em duas rodadas", async () => {
    // Dado
    hashes = { "staging:msg:a": mensagem(topicoDe(ESTACAO), "encaminhada") };
    rodadas = [
      { cursor: 5, keys: ["staging:msg:a"] },
      { cursor: 0, keys: ["staging:msg:a"] },
    ];

    // Quando
    const mensagens = await listarMensagensVerificadas(ESTACAO);

    // Então
    expect(mensagens).toHaveLength(1);
  });

  it("deve pular a chave que expirou entre o SCAN e a leitura", async () => {
    // Dado: a chave foi listada mas já não existe.
    rodadas = [{ cursor: 0, keys: ["staging:msg:sumiu"] }];

    // Quando / Então
    await expect(listarMensagensVerificadas(ESTACAO)).resolves.toEqual([]);
  });

  it("deve pular a mensagem a que falta o payload ou a hora de chegada", async () => {
    // Dado
    const incompleta: Hash = { topico: topicoDe(ESTACAO), status: "encaminhada" };
    hashes = { "staging:msg:a": incompleta };
    rodadas = [{ cursor: 0, keys: ["staging:msg:a"] }];

    // Quando / Então
    await expect(listarMensagensVerificadas(ESTACAO)).resolves.toEqual([]);
  });

  it("deve só ler: nenhum comando de escrita é usado", async () => {
    // Dado
    hashes = { "staging:msg:a": mensagem(topicoDe(ESTACAO), "encaminhada") };
    rodadas = [{ cursor: 0, keys: ["staging:msg:a"] }];

    // Quando
    await listarMensagensVerificadas(ESTACAO);

    // Então: o cliente falso só tem scan e hmGet; qualquer outro comando teria falhado.
    expect(Object.keys(cliente).sort()).toEqual(["hmGet", "scan"]);
  });

  it("deve repassar o erro quando o Valkey está fora", async () => {
    // Dado
    const erro = new Error("The client is closed");
    cliente.scan.mockRejectedValue(erro);

    // Quando / Então
    await expect(listarMensagensVerificadas(ESTACAO)).rejects.toBe(erro);
  });
});
