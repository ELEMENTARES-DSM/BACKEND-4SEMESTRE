import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { PoolClient } from "pg";
import { pool } from "../../config/db";
import {
  atualizarSinalEstacao,
  buscarStatusEstacao,
} from "../../repositories/estacao.repository";

describe("estacao.repository - buscarStatusEstacao", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("retorna o status do cadastro lendo só a tabela estacoes", async () => {
    const consulta = jest
      .spyOn(pool, "query")
      .mockResolvedValue({ rows: [{ status: "Inativa" }] } as never);

    await expect(buscarStatusEstacao("estacao-123")).resolves.toBe("Inativa");
    expect(consulta.mock.calls[0]).toEqual([
      "SELECT status FROM estacoes WHERE id = $1",
      ["estacao-123"],
    ]);
  });

  it("retorna null quando a estação não existe", async () => {
    jest.spyOn(pool, "query").mockResolvedValue({ rows: [] } as never);

    await expect(buscarStatusEstacao("estacao-inexistente")).resolves.toBeNull();
  });
});

describe("estacao.repository - atualizarSinalEstacao", () => {
  let mockClient: jest.Mocked<PoolClient>;

  beforeEach(() => {
    mockClient = {
      query: jest.fn(),
    } as unknown as jest.Mocked<PoolClient>;
  });

  it("deve atualizar ultimo_ping e nivel_bateria quando nivelBateria for informado", async () => {
    (mockClient.query as jest.Mock).mockResolvedValue({ rowCount: 1 } as never);

    const resultado = await atualizarSinalEstacao(mockClient, {
      estacaoId: "estacao-123",
      ultimoPing: "2026-10-16T10:00:00.000Z",
      nivelBateria: 87,
    });

    expect(resultado).toBe(true);
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE estacoes"),
      ["2026-10-16T10:00:00.000Z", 87, "estacao-123"],
    );
  });

  it("deve atualizar apenas ultimo_ping quando nivelBateria for undefined", async () => {
    (mockClient.query as jest.Mock).mockResolvedValue({ rowCount: 1 } as never);

    const resultado = await atualizarSinalEstacao(mockClient, {
      estacaoId: "estacao-123",
      ultimoPing: "2026-10-16T10:00:00.000Z",
      nivelBateria: undefined,
    });

    expect(resultado).toBe(true);
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE estacoes"),
      ["2026-10-16T10:00:00.000Z", "estacao-123"],
    );
  });
});
