import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { buscarStatusEstacao } from "../../repositories/estacao.repository";
import { conferirEstacao } from "../../services/validar-estacao.service";

jest.mock("../../repositories/estacao.repository");

const statusEstacao = jest.mocked(buscarStatusEstacao);
const ESTACAO = "8723c462-e79c-4e58-9751-eef8868a5312";

describe("conferirEstacao (US-12)", () => {
  beforeEach(() => {
    statusEstacao.mockReset();
  });

  it("aceita estação Ativa", async () => {
    statusEstacao.mockResolvedValue("Ativa");
    await expect(conferirEstacao(ESTACAO)).resolves.toBeUndefined();
    expect(statusEstacao).toHaveBeenCalledWith(ESTACAO);
  });

  it("aceita estação Com Falha, que é situação do último sinal e não cadastro", async () => {
    statusEstacao.mockResolvedValue("Com Falha");
    await expect(conferirEstacao(ESTACAO)).resolves.toBeUndefined();
  });

  it("rejeita estação que não existe com \"Estação desconhecida\"", async () => {
    statusEstacao.mockResolvedValue(null);
    await expect(conferirEstacao(ESTACAO)).resolves.toBe("Estação desconhecida");
  });

  it("rejeita estação Inativa com \"Estação inativa\"", async () => {
    statusEstacao.mockResolvedValue("Inativa");
    await expect(conferirEstacao(ESTACAO)).resolves.toBe("Estação inativa");
  });

  it("propaga erro do banco para a mensagem não ser confirmada", async () => {
    const erro = new Error("connection refused");
    statusEstacao.mockRejectedValue(erro);
    await expect(conferirEstacao(ESTACAO)).rejects.toBe(erro);
  });
});
