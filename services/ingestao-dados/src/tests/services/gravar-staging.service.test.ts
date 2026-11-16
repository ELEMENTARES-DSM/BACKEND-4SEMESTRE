import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { PoolClient } from "pg";
import { pool } from "../../config/db";
import { gravarAceita } from "../../services/gravar-staging.service";
import * as stagingRepository from "../../repositories/staging.repository";
import * as estacaoRepository from "../../repositories/estacao.repository";

// Unitário: PostgreSQL mockado.
jest.mock("../../config/db");
jest.mock("../../repositories/staging.repository");
jest.mock("../../repositories/estacao.repository");

const ID_VALKEY = "11111111-1111-4111-8111-111111111111";

describe("TASK 14.02 · gravação da aceita na staging_telemetria", () => {
  let mockClient: jest.Mocked<PoolClient>;

  beforeEach(() => {
    const mockQuery = jest.fn() as unknown as jest.MockedFunction<PoolClient["query"]>;
    mockQuery.mockResolvedValue({ command: "SELECT", rowCount: 1, oid: 0, fields: [], rows: [] });

    mockClient = {
      query: mockQuery,
      release: jest.fn(),
      on: jest.fn(),
      removeListener: jest.fn(),
    } as unknown as jest.Mocked<PoolClient>;

    jest.mocked(pool.connect).mockResolvedValue(mockClient);
  });

  const mensagem = (dados: Record<string, unknown>) => ({
    estacaoId: "e30a57e3-0d33-4f9e-86b2-6cb1690a7891",
    topico: "pulso/estacoes/e30a57e3-0d33-4f9e-86b2-6cb1690a7891/telemetria",
    recebidoEm: "2026-10-16T10:00:00.000Z",
    payloadBruto: JSON.stringify({
      timestamp: "2026-10-16T09:55:00Z",
      leituras: [{ sensor: "TMP", valor: 25.0 }],
      ...dados,
    }),
  });

  it("deve gravar com o id do Valkey e atualizar ultimo_ping e nivel_bateria na mesma transação quando a mensagem é aceita", async () => {
    // Dado (Arrange)
    const aceita = mensagem({ nivel_bateria: 87 });
    jest.mocked(stagingRepository.inserirStaging).mockResolvedValue(true);
    jest.mocked(estacaoRepository.atualizarSinalEstacao).mockResolvedValue(true);

    // Quando (Act)
    const resultado = await gravarAceita(aceita, ID_VALKEY);

    // Então (Assert)
    expect(resultado).toBe("recebida");
    expect(stagingRepository.inserirStaging).toHaveBeenCalledWith(
      expect.objectContaining({ id: ID_VALKEY, status: "recebida" }),
      mockClient,
    );
    expect(mockClient.query).toHaveBeenCalledWith("BEGIN");
    expect(mockClient.query).toHaveBeenCalledWith("COMMIT");
    expect(mockClient.release).toHaveBeenCalled();
    expect(estacaoRepository.atualizarSinalEstacao).toHaveBeenCalledWith(mockClient, {
      estacaoId: aceita.estacaoId,
      ultimoPing: aceita.recebidoEm,
      nivelBateria: 87,
    });
  });

  it("deve atualizar ultimo_ping mantendo a bateria quando nivel_bateria é ausente", async () => {
    // Dado (Arrange)
    const aceita = mensagem({});
    jest.mocked(stagingRepository.inserirStaging).mockResolvedValue(true);

    // Quando (Act)
    const resultado = await gravarAceita(aceita, ID_VALKEY);

    // Então (Assert)
    expect(resultado).toBe("recebida");
    expect(estacaoRepository.atualizarSinalEstacao).toHaveBeenCalledWith(mockClient, {
      estacaoId: aceita.estacaoId,
      ultimoPing: aceita.recebidoEm,
      nivelBateria: undefined,
    });
  });

  it("deve não atualizar a estação quando a mensagem é duplicata", async () => {
    // Dado (Arrange)
    jest.mocked(stagingRepository.inserirStaging).mockResolvedValue(false);

    // Quando (Act)
    const resultado = await gravarAceita(mensagem({}), ID_VALKEY);

    // Então (Assert)
    expect(resultado).toBe("duplicata");
    expect(mockClient.query).toHaveBeenCalledWith("COMMIT");
    expect(estacaoRepository.atualizarSinalEstacao).not.toHaveBeenCalled();
  });

  it("deve dar ROLLBACK quando a atualização da estação falha", async () => {
    // Dado (Arrange)
    jest.mocked(stagingRepository.inserirStaging).mockResolvedValue(true);
    jest.mocked(estacaoRepository.atualizarSinalEstacao).mockRejectedValue(new Error("Erro ao acessar banco de dados"));

    // Quando (Act)
    const resultado = gravarAceita(mensagem({}), ID_VALKEY);

    // Então (Assert)
    await expect(resultado).rejects.toThrow("Erro ao acessar banco de dados");
    expect(mockClient.query).toHaveBeenCalledWith("ROLLBACK");
    expect(mockClient.release).toHaveBeenCalled();
  });
});
