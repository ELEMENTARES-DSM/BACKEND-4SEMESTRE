import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { pool } from "../../config/db";
import { atualizarSinalEstacao, buscarEstacaoParaValidacao } from "../../repositories/estacao.repository";

// Unitário: o PostgreSQL (pool e cliente) é mockado.
describe("buscarEstacaoParaValidacao", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("deve devolver o status e o criado_em lendo só a tabela estacoes quando a estação existe", async () => {
    // Dado (Arrange)
    const criado_em = new Date("2026-01-01T00:00:00Z");
    const consulta = jest.spyOn(pool, "query").mockResolvedValue({ rows: [{ status: "Inativa", criado_em }] } as never);

    // Quando (Act)
    const estacao = await buscarEstacaoParaValidacao("estacao-123");

    // Então (Assert)
    expect(estacao).toEqual({ status: "Inativa", criado_em });
    expect(consulta.mock.calls[0]).toEqual(["SELECT status, criado_em FROM estacoes WHERE id = $1", ["estacao-123"]]);
  });

  it("deve devolver null quando a estação não existe", async () => {
    // Dado (Arrange)
    jest.spyOn(pool, "query").mockResolvedValue({ rows: [] } as never);

    // Quando (Act)
    const estacao = await buscarEstacaoParaValidacao("estacao-inexistente");

    // Então (Assert)
    expect(estacao).toBeNull();
  });
});

describe("atualizarSinalEstacao", () => {
  // pool.query tem várias sobrecargas; o mock só precisa de chamada e resultado.
  let consulta: jest.Mock<(...args: unknown[]) => Promise<unknown>>;

  beforeEach(() => {
    consulta = jest.spyOn(pool, "query").mockResolvedValue({ rowCount: 1 } as never) as unknown as typeof consulta;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("deve atualizar ultimo_ping e nivel_bateria quando nivelBateria é informado", async () => {
    // Dado (Arrange)
    const sinal = { estacaoId: "estacao-123", ultimoPing: "2026-10-16T10:00:00.000Z", nivelBateria: 87 };

    // Quando (Act)
    const atualizou = await atualizarSinalEstacao(sinal);

    // Então (Assert)
    expect(atualizou).toBe(true);
    expect(consulta).toHaveBeenCalledWith(
      expect.stringContaining("nivel_bateria = COALESCE($2, nivel_bateria)"),
      ["2026-10-16T10:00:00.000Z", 87, "estacao-123"],
    );
  });

  it("deve manter a bateria guardada, passando null, quando nivelBateria é undefined", async () => {
    // Dado (Arrange)
    const sinal = { estacaoId: "estacao-123", ultimoPing: "2026-10-16T10:00:00.000Z", nivelBateria: undefined };

    // Quando (Act)
    await atualizarSinalEstacao(sinal);

    // Então (Assert)
    expect(consulta).toHaveBeenCalledWith(expect.stringContaining("UPDATE estacoes"), [
      "2026-10-16T10:00:00.000Z",
      null,
      "estacao-123",
    ]);
  });

  it("deve devolver false quando a estação não existe", async () => {
    // Dado (Arrange)
    consulta.mockResolvedValue({ rowCount: 0 } as never);

    // Quando (Act)
    const atualizou = await atualizarSinalEstacao({ estacaoId: "x", ultimoPing: "2026-10-16T10:00:00.000Z" });

    // Então (Assert)
    expect(atualizou).toBe(false);
  });

  it("deve propagar o erro quando o PostgreSQL está fora", async () => {
    // Dado (Arrange)
    const erro = new Error("connect ECONNREFUSED");
    consulta.mockRejectedValue(erro);

    // Quando (Act)
    const resultado = atualizarSinalEstacao({ estacaoId: "x", ultimoPing: "2026-10-16T10:00:00.000Z" });

    // Então (Assert)
    await expect(resultado).rejects.toBe(erro);
  });
});
