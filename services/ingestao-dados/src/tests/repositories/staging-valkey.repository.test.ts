import { valkey } from "../../config/valkey";
import {
  chaveMensagem,
  contarPendentes,
  encerrarSemPublicar,
  gravarBruta,
  LISTA_PENDENTES,
  LISTA_RECEBIDAS,
  marcarEncaminhada,
  marcarPendente,
  proximaPendente,
  RETENCAO_MS,
} from "../../repositories/staging-valkey.repository";

// Unitário: o cliente do Valkey é falso e registra os comandos de cada MULTI.
jest.mock("../../config/valkey");

type Comando = [string, ...unknown[]];

const AGORA = new Date("2026-11-16T10:00:00.000Z");
const SETE_DIAS_DEPOIS = new Date("2026-11-23T10:00:00.000Z");

describe("staging-valkey.repository", () => {
  let comandos: Comando[];
  let cliente: Record<string, jest.Mock>;

  beforeEach(() => {
    comandos = [];
    const transacao: Record<string, jest.Mock> = {};
    for (const nome of ["hSet", "rPush", "lRem", "expireAt"]) {
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
    };
    jest.mocked(valkey).mockReturnValue(cliente as never);
  });

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
      ]);
    });
  });

  describe("US-40 · Cenário 7 · expiração em 7 dias", () => {
    it("deve marcar encaminhada e expirar 7 dias depois do agora simulado quando o RabbitMQ confirma", async () => {
      // Dado (Arrange)
      // Quando (Act)
      await marcarEncaminhada("id-1", AGORA);

      // Então (Assert)
      expect(comandos).toContainEqual(["hSet", chaveMensagem("id-1"), { status: "encaminhada" }]);
      expect(comandos).toContainEqual(["expireAt", chaveMensagem("id-1"), SETE_DIAS_DEPOIS]);
      expect(RETENCAO_MS).toBe(7 * 24 * 60 * 60 * 1000);
    });

    it.each(["recusada", "duplicada"] as const)(
      "deve expirar 7 dias depois do agora simulado quando a mensagem fica %s",
      async (status) => {
        // Dado (Arrange)
        // Quando (Act)
        await encerrarSemPublicar("id-1", status, AGORA);

        // Então (Assert)
        expect(comandos).toContainEqual(["expireAt", chaveMensagem("id-1"), SETE_DIAS_DEPOIS]);
        expect(comandos).toContainEqual(["lRem", LISTA_RECEBIDAS, 1, "id-1"]);
      },
    );

    it("deve gravar o motivo junto com o status quando a mensagem é recusada", async () => {
      // Dado (Arrange)
      // Quando (Act)
      await encerrarSemPublicar("id-1", "recusada", AGORA, "Nível de bateria fora de 0 a 100");

      // Então (Assert)
      expect(comandos).toContainEqual([
        "hSet", chaveMensagem("id-1"), { status: "recusada", motivo: "Nível de bateria fora de 0 a 100" },
      ]);
    });

    it("deve não definir expiração quando a mensagem fica pendente", async () => {
      // Dado (Arrange)
      // Quando (Act)
      await marcarPendente("id-1");

      // Então (Assert)
      expect(comandos.map(([nome]) => nome)).not.toContain("expireAt");
      expect(comandos).toContainEqual(["rPush", LISTA_PENDENTES, "id-1"]);
      expect(comandos).toContainEqual(["lRem", LISTA_RECEBIDAS, 1, "id-1"]);
    });
  });

  describe("US-40 · saída da lista pelo id", () => {
    it("deve tirar da lista com LREM pelo id, e não com LPOP, quando marca encaminhada", async () => {
      // Dado (Arrange)
      // Quando (Act)
      await marcarEncaminhada("id-1", AGORA);

      // Então (Assert)
      expect(comandos).toContainEqual(["lRem", LISTA_PENDENTES, 1, "id-1"]);
      expect(cliente.lPop).toBeUndefined();
    });

    it("deve ler a frente da lista sem tirar quando busca a próxima pendente", async () => {
      // Dado (Arrange)
      // Quando (Act)
      const id = await proximaPendente();

      // Então (Assert)
      expect(id).toBe("id-da-frente");
      expect(cliente.lIndex).toHaveBeenCalledWith(LISTA_PENDENTES, 0);
    });

    it("deve contar as pendentes pelo tamanho da lista quando a métrica é lida", async () => {
      // Dado (Arrange)
      // Quando (Act)
      const total = await contarPendentes();

      // Então (Assert)
      expect(total).toBe(3);
      expect(cliente.lLen).toHaveBeenCalledWith(LISTA_PENDENTES);
    });
  });
});
