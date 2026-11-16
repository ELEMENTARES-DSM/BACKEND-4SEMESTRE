import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { buscarEstacaoParaValidacao } from "../../repositories/estacao.repository";
import { conferirEstacao, limparCadastrosConhecidos } from "../../services/validar-estacao.service";
import { logger } from "../../utils/logger";

// Unitário: PostgreSQL (repository) mockado.
jest.mock("../../repositories/estacao.repository");

const estacaoValidacao = jest.mocked(buscarEstacaoParaValidacao);
const ESTACAO = "8723c462-e79c-4e58-9751-eef8868a5312";
const RECEBIDO = "2026-10-14T12:00:00Z";
const CADASTRO = new Date("2026-01-01T00:00:00Z");

describe("conferirEstacao (US-12)", () => {
  beforeEach(() => {
    estacaoValidacao.mockReset();
    limparCadastrosConhecidos();
  });

  it("aceita estação Ativa", async () => {
    estacaoValidacao.mockResolvedValue({ status: "Ativa", criado_em: CADASTRO });
    await expect(conferirEstacao(ESTACAO, RECEBIDO, RECEBIDO)).resolves.toBeUndefined();
    expect(estacaoValidacao).toHaveBeenCalledWith(ESTACAO);
  });

  it("aceita estação Com Falha, que é situação do último sinal e não cadastro", async () => {
    estacaoValidacao.mockResolvedValue({ status: "Com Falha", criado_em: CADASTRO });
    await expect(conferirEstacao(ESTACAO, RECEBIDO, RECEBIDO)).resolves.toBeUndefined();
  });

  it("rejeita estação que não existe com \"Estação desconhecida\"", async () => {
    estacaoValidacao.mockResolvedValue(null);
    await expect(conferirEstacao(ESTACAO, RECEBIDO, RECEBIDO)).resolves.toBe("Estação desconhecida");
  });

  it("rejeita estação Inativa com \"Estação inativa\"", async () => {
    estacaoValidacao.mockResolvedValue({ status: "Inativa", criado_em: CADASTRO });
    await expect(conferirEstacao(ESTACAO, RECEBIDO, RECEBIDO)).resolves.toBe("Estação inativa");
  });

  it("deve propagar o erro, que é temporário, quando o banco falha e a estação nunca foi vista", async () => {
    // Dado (Arrange)
    const erro = new Error("connection refused");
    estacaoValidacao.mockRejectedValue(erro);

    // Quando (Act)
    const resultado = conferirEstacao(ESTACAO, RECEBIDO, RECEBIDO);

    // Então (Assert)
    await expect(resultado).rejects.toBe(erro);
  });

  it("aceita leitura exatamente 5 min à frente do recebimento", async () => {
    estacaoValidacao.mockResolvedValue({ status: "Ativa", criado_em: CADASTRO });
    await expect(conferirEstacao(ESTACAO, "2026-10-14T12:05:00Z", RECEBIDO)).resolves.toBeUndefined();
  });

  it("rejeita leitura 5 min e 1 s à frente com Timestamp fora da faixa", async () => {
    estacaoValidacao.mockResolvedValue({ status: "Ativa", criado_em: CADASTRO });
    await expect(conferirEstacao(ESTACAO, "2026-10-14T12:05:01Z", RECEBIDO)).resolves.toBe("Timestamp fora da faixa");
  });

  it("rejeita leitura de 1970-01-01T00:00:00Z", async () => {
    estacaoValidacao.mockResolvedValue({ status: "Ativa", criado_em: CADASTRO });
    await expect(conferirEstacao(ESTACAO, "1970-01-01T00:00:00Z", RECEBIDO)).resolves.toBe("Timestamp fora da faixa");
  });

  it("rejeita leitura 1 s antes do cadastro da estação", async () => {
    estacaoValidacao.mockResolvedValue({ status: "Ativa", criado_em: new Date("2026-01-01T00:00:00.999Z") });
    await expect(conferirEstacao(ESTACAO, "2025-12-31T23:59:59Z", RECEBIDO)).resolves.toBe("Timestamp fora da faixa");
  });

  it("aceita leitura no mesmo segundo do cadastro", async () => {
    estacaoValidacao.mockResolvedValue({ status: "Ativa", criado_em: new Date("2026-01-01T00:00:00.999Z") });
    await expect(conferirEstacao(ESTACAO, "2026-01-01T00:00:00Z", RECEBIDO)).resolves.toBeUndefined();
  });
});

describe("US-40 · Cenário 4 · cache de estação com o PostgreSQL fora", () => {
  const banco = new Error("connection refused");

  beforeEach(() => {
    estacaoValidacao.mockReset();
    limparCadastrosConhecidos();
    jest.spyOn(logger, "warn").mockImplementation(() => undefined);
  });

  it("deve aceitar com o último cadastro lido quando o banco falha e a estação já foi vista Ativa", async () => {
    // Dado (Arrange)
    estacaoValidacao.mockResolvedValueOnce({ status: "Ativa", criado_em: CADASTRO }).mockRejectedValue(banco);
    await conferirEstacao(ESTACAO, RECEBIDO, RECEBIDO);

    // Quando (Act)
    const resultado = await conferirEstacao(ESTACAO, RECEBIDO, RECEBIDO);

    // Então (Assert)
    expect(resultado).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      "PostgreSQL indisponível: usando o último cadastro lido da estação",
      { estacaoId: ESTACAO, erro: "connection refused" },
    );
  });

  it("deve recusar como inativa com o último cadastro lido quando o banco falha e a estação foi vista Inativa", async () => {
    // Dado (Arrange)
    estacaoValidacao.mockResolvedValueOnce({ status: "Inativa", criado_em: CADASTRO }).mockRejectedValue(banco);
    await conferirEstacao(ESTACAO, RECEBIDO, RECEBIDO);

    // Quando (Act)
    const resultado = await conferirEstacao(ESTACAO, RECEBIDO, RECEBIDO);

    // Então (Assert)
    expect(resultado).toBe("Estação inativa");
  });

  it("deve usar o criado_em guardado na regra de horário quando o banco falha", async () => {
    // Dado (Arrange)
    estacaoValidacao.mockResolvedValueOnce({ status: "Ativa", criado_em: CADASTRO }).mockRejectedValue(banco);
    await conferirEstacao(ESTACAO, RECEBIDO, RECEBIDO);

    // Quando (Act)
    const resultado = await conferirEstacao(ESTACAO, "2025-12-31T23:59:59Z", RECEBIDO);

    // Então (Assert)
    expect(resultado).toBe("Timestamp fora da faixa");
  });

  it("deve usar o banco, e não o cache, quando ele responde", async () => {
    // Dado (Arrange)
    estacaoValidacao
      .mockResolvedValueOnce({ status: "Ativa", criado_em: CADASTRO })
      .mockResolvedValueOnce({ status: "Inativa", criado_em: CADASTRO });
    await conferirEstacao(ESTACAO, RECEBIDO, RECEBIDO);

    // Quando (Act)
    const resultado = await conferirEstacao(ESTACAO, RECEBIDO, RECEBIDO);

    // Então (Assert)
    expect(resultado).toBe("Estação inativa");
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("deve esquecer a estação, e propagar o erro depois, quando o banco responde que ela não existe mais", async () => {
    // Dado (Arrange)
    estacaoValidacao
      .mockResolvedValueOnce({ status: "Ativa", criado_em: CADASTRO })
      .mockResolvedValueOnce(null)
      .mockRejectedValue(banco);
    await conferirEstacao(ESTACAO, RECEBIDO, RECEBIDO);
    await conferirEstacao(ESTACAO, RECEBIDO, RECEBIDO);

    // Quando (Act)
    const resultado = conferirEstacao(ESTACAO, RECEBIDO, RECEBIDO);

    // Então (Assert)
    await expect(resultado).rejects.toBe(banco);
  });
});
