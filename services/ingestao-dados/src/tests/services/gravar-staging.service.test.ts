import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { PoolClient } from "pg";
import { pool } from "../../config/db";
import { gravarAceita, gravarRejeitada } from "../../services/gravar-staging.service";
import { inserirStaging } from "../../repositories/staging.repository";
import { atualizarSinalEstacao } from "../../repositories/estacao.repository";

// Unitário: PostgreSQL (pool e repositories) mockado; a validação do payload é pura e entra real.
jest.mock("../../config/db");
jest.mock("../../repositories/staging.repository");
jest.mock("../../repositories/estacao.repository");

const ID_VALKEY = "11111111-1111-4111-8111-111111111111";
const ESTACAO = "e30a57e3-0d33-4f9e-86b2-6cb1690a7891";

const mensagem = (payloadBruto: string) => ({
  estacaoId: ESTACAO,
  topico: `pulso/estacoes/${ESTACAO}/telemetria`,
  recebidoEm: "2026-10-16T10:00:00.000Z",
  payloadBruto,
});

const aceita = (extras: Record<string, unknown> = {}) =>
  mensagem(JSON.stringify({ timestamp: "2026-10-16T09:55:00Z", leituras: [{ sensor: "TMP", valor: 25.0 }], ...extras }));

describe("gravarAceita", () => {
  let mockClient: jest.Mocked<PoolClient>;

  beforeEach(() => {
    const mockQuery = jest.fn() as unknown as jest.MockedFunction<PoolClient["query"]>;
    mockQuery.mockResolvedValue({ command: "SELECT", rowCount: 1, oid: 0, fields: [], rows: [] });
    mockClient = { query: mockQuery, release: jest.fn(), on: jest.fn(), removeListener: jest.fn() } as unknown as jest.Mocked<PoolClient>;
    jest.mocked(pool.connect).mockResolvedValue(mockClient as never);
    jest.mocked(inserirStaging).mockResolvedValue(true);
    jest.mocked(atualizarSinalEstacao).mockResolvedValue(true);
  });

  it("deve gravar com o id do Valkey e atualizar ultimo_ping e nivel_bateria na mesma transação quando a mensagem é aceita", async () => {
    // Dado (Arrange)
    const leitura = aceita({ nivel_bateria: 87 });

    // Quando (Act)
    const resultado = await gravarAceita(leitura, ID_VALKEY);

    // Então (Assert)
    expect(resultado).toBe("recebida");
    expect(inserirStaging).toHaveBeenCalledWith(
      {
        id: ID_VALKEY,
        estacaoId: ESTACAO,
        unixtime: Date.parse("2026-10-16T09:55:00Z") / 1000,
        recebidoEm: leitura.recebidoEm,
        payloadBruto: leitura.payloadBruto,
        payloadJson: leitura.payloadBruto,
        status: "recebida",
        motivoRejeicao: null,
      },
      mockClient,
    );
    expect(mockClient.query).toHaveBeenCalledWith("BEGIN");
    expect(mockClient.query).toHaveBeenCalledWith("COMMIT");
    expect(mockClient.release).toHaveBeenCalled();
    expect(atualizarSinalEstacao).toHaveBeenCalledWith(mockClient, {
      estacaoId: ESTACAO,
      ultimoPing: leitura.recebidoEm,
      nivelBateria: 87,
    });
  });

  it("deve atualizar o ultimo_ping mantendo a bateria quando nivel_bateria é ausente", async () => {
    // Dado (Arrange)
    const leitura = aceita();

    // Quando (Act)
    await gravarAceita(leitura, ID_VALKEY);

    // Então (Assert)
    expect(atualizarSinalEstacao).toHaveBeenCalledWith(mockClient, {
      estacaoId: ESTACAO,
      ultimoPing: leitura.recebidoEm,
      nivelBateria: undefined,
    });
  });

  it("deve devolver duplicata sem atualizar a estação quando o insert não grava", async () => {
    // Dado (Arrange)
    jest.mocked(inserirStaging).mockResolvedValue(false);

    // Quando (Act)
    const resultado = await gravarAceita(aceita(), ID_VALKEY);

    // Então (Assert)
    expect(resultado).toBe("duplicata");
    expect(mockClient.query).toHaveBeenCalledWith("COMMIT");
    expect(atualizarSinalEstacao).not.toHaveBeenCalled();
  });

  it("deve dar ROLLBACK e propagar o erro quando a atualização da estação falha", async () => {
    // Dado (Arrange)
    jest.mocked(atualizarSinalEstacao).mockRejectedValue(new Error("Erro ao acessar banco de dados"));

    // Quando (Act)
    const resultado = gravarAceita(aceita(), ID_VALKEY);

    // Então (Assert)
    await expect(resultado).rejects.toThrow("Erro ao acessar banco de dados");
    expect(mockClient.query).toHaveBeenCalledWith("ROLLBACK");
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("deve lançar sem abrir transação quando a mensagem não passa na validação", async () => {
    // Dado (Arrange)
    const invalida = mensagem("não é JSON");

    // Quando (Act)
    const resultado = gravarAceita(invalida, ID_VALKEY);

    // Então (Assert)
    await expect(resultado).rejects.toThrow("Payload malformado");
    expect(pool.connect).not.toHaveBeenCalled();
  });
});

describe("gravarRejeitada", () => {
  beforeEach(() => {
    jest.mocked(inserirStaging).mockResolvedValue(true);
  });

  it("deve gravar com o id do Valkey, status rejeitada e o motivo quando a mensagem é recusada", async () => {
    // Dado (Arrange)
    const leitura = aceita();

    // Quando (Act)
    const resultado = await gravarRejeitada(leitura, "Estação inativa", ID_VALKEY);

    // Então (Assert)
    expect(resultado).toBe("rejeitada");
    expect(inserirStaging).toHaveBeenCalledWith(expect.objectContaining({
      id: ID_VALKEY,
      estacaoId: ESTACAO,
      status: "rejeitada",
      motivoRejeicao: "Estação inativa",
      payloadJson: leitura.payloadBruto,
    }));
  });

  it("deve gravar o texto como chegou, sem JSON nem unixtime, quando o conteúdo não é JSON", async () => {
    // Dado (Arrange)
    const leitura = mensagem("  mensagem quebrada\n");

    // Quando (Act)
    await gravarRejeitada(leitura, "Payload malformado", ID_VALKEY);

    // Então (Assert)
    expect(inserirStaging).toHaveBeenCalledWith(expect.objectContaining({
      payloadBruto: "  mensagem quebrada\n",
      payloadJson: null,
      unixtime: null,
    }));
  });

  it("deve guardar o JSON e o unixtime quando o conteúdo é JSON com timestamp válido", async () => {
    // Dado (Arrange)
    const bruto = '{"timestamp":"2026-10-14T12:00:00Z","leituras":[]}';

    // Quando (Act)
    await gravarRejeitada(mensagem(bruto), "Lista de leituras ausente ou vazia", ID_VALKEY);

    // Então (Assert)
    expect(inserirStaging).toHaveBeenCalledWith(expect.objectContaining({
      payloadJson: bruto,
      unixtime: Date.parse("2026-10-14T12:00:00Z") / 1000,
    }));
  });

  it.each(["null", "[]", '{"timestamp":"inválido"}'])(
    "deve guardar o JSON sem unixtime quando o timestamp não é válido: %s",
    async (bruto) => {
      // Dado (Arrange)
      // Quando (Act)
      await gravarRejeitada(mensagem(bruto), "Timestamp ausente ou inválido", ID_VALKEY);

      // Então (Assert)
      expect(inserirStaging).toHaveBeenCalledWith(expect.objectContaining({ payloadJson: bruto, unixtime: null }));
    },
  );

  it.each(["", "   ", "x".repeat(256)])(
    "deve lançar sem gravar quando o motivo é vazio ou passa de 255 caracteres: %#",
    async (motivo) => {
      // Dado (Arrange)
      // Quando (Act)
      const resultado = gravarRejeitada(aceita(), motivo, ID_VALKEY);

      // Então (Assert)
      await expect(resultado).rejects.toThrow("O motivo da rejeição deve ter entre 1 e 255 caracteres");
      expect(inserirStaging).not.toHaveBeenCalled();
    },
  );
});
