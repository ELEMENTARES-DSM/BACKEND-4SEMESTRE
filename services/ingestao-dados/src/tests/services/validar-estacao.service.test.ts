import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { buscarEstacaoParaValidacao } from "../../repositories/estacao.repository";
import { conferirEstacao, limparCadastrosConhecidos } from "../../services/validar-estacao.service";
import { logger } from "../../utils/logger";

// Unitário: PostgreSQL (repository) mockado.
jest.mock("../../repositories/estacao.repository");

const buscar = jest.mocked(buscarEstacaoParaValidacao);
const ESTACAO = "8723c462-e79c-4e58-9751-eef8868a5312";
const RECEBIDO = "2026-10-14T12:00:00Z";
const CADASTRO = new Date("2026-01-01T00:00:00Z");
const BANCO_FORA = new Error("connection refused");

beforeEach(() => {
  limparCadastrosConhecidos();
  jest.spyOn(logger, "warn").mockImplementation(() => undefined);
});

describe("conferirEstacao", () => {
  describe("US-12 · estação do tópico", () => {
    it("deve aceitar quando a estação está Ativa", async () => {
      // Dado (Arrange)
      buscar.mockResolvedValue({ status: "Ativa", criado_em: CADASTRO });

      // Quando (Act)
      const motivo = await conferirEstacao(ESTACAO, RECEBIDO, RECEBIDO);

      // Então (Assert)
      expect(motivo).toBeUndefined();
      expect(buscar).toHaveBeenCalledWith(ESTACAO);
    });

    it("deve aceitar quando a estação está Com Falha, que é situação do último sinal e não cadastro", async () => {
      // Dado (Arrange)
      buscar.mockResolvedValue({ status: "Com Falha", criado_em: CADASTRO });

      // Quando (Act)
      const motivo = await conferirEstacao(ESTACAO, RECEBIDO, RECEBIDO);

      // Então (Assert)
      expect(motivo).toBeUndefined();
    });

    it("deve recusar com \"Estação desconhecida\" quando a estação não existe", async () => {
      // Dado (Arrange)
      buscar.mockResolvedValue(null);

      // Quando (Act)
      const motivo = await conferirEstacao(ESTACAO, RECEBIDO, RECEBIDO);

      // Então (Assert)
      expect(motivo).toBe("Estação desconhecida");
    });

    it("deve recusar com \"Estação inativa\" quando a estação está Inativa", async () => {
      // Dado (Arrange)
      buscar.mockResolvedValue({ status: "Inativa", criado_em: CADASTRO });

      // Quando (Act)
      const motivo = await conferirEstacao(ESTACAO, RECEBIDO, RECEBIDO);

      // Então (Assert)
      expect(motivo).toBe("Estação inativa");
    });
  });

  describe("US-28 · horário da leitura", () => {
    beforeEach(() => {
      buscar.mockResolvedValue({ status: "Ativa", criado_em: CADASTRO });
    });

    it("deve aceitar quando a leitura está exatamente 5 min à frente do recebimento", async () => {
      // Dado (Arrange)
      const timestamp = "2026-10-14T12:05:00Z";

      // Quando (Act)
      const motivo = await conferirEstacao(ESTACAO, timestamp, RECEBIDO);

      // Então (Assert)
      expect(motivo).toBeUndefined();
    });

    it("deve recusar com \"Timestamp fora da faixa\" quando a leitura está 5 min e 1 s à frente", async () => {
      // Dado (Arrange)
      const timestamp = "2026-10-14T12:05:01Z";

      // Quando (Act)
      const motivo = await conferirEstacao(ESTACAO, timestamp, RECEBIDO);

      // Então (Assert)
      expect(motivo).toBe("Timestamp fora da faixa");
    });

    it("deve recusar com \"Timestamp fora da faixa\" quando a leitura é de 1970-01-01T00:00:00Z", async () => {
      // Dado (Arrange)
      const timestamp = "1970-01-01T00:00:00Z";

      // Quando (Act)
      const motivo = await conferirEstacao(ESTACAO, timestamp, RECEBIDO);

      // Então (Assert)
      expect(motivo).toBe("Timestamp fora da faixa");
    });

    it("deve recusar com \"Timestamp fora da faixa\" quando a leitura é 1 s antes do cadastro", async () => {
      // Dado (Arrange)
      buscar.mockResolvedValue({ status: "Ativa", criado_em: new Date("2026-01-01T00:00:00.999Z") });

      // Quando (Act)
      const motivo = await conferirEstacao(ESTACAO, "2025-12-31T23:59:59Z", RECEBIDO);

      // Então (Assert)
      expect(motivo).toBe("Timestamp fora da faixa");
    });

    it("deve aceitar quando a leitura é do mesmo segundo do cadastro", async () => {
      // Dado (Arrange)
      buscar.mockResolvedValue({ status: "Ativa", criado_em: new Date("2026-01-01T00:00:00.999Z") });

      // Quando (Act)
      const motivo = await conferirEstacao(ESTACAO, "2026-01-01T00:00:00Z", RECEBIDO);

      // Então (Assert)
      expect(motivo).toBeUndefined();
    });
  });

  describe("US-40 · Cenário 4 · cache de estação com o PostgreSQL fora", () => {
    it("deve propagar o erro, que é temporário, quando o banco falha e a estação nunca foi vista", async () => {
      // Dado (Arrange)
      buscar.mockRejectedValue(BANCO_FORA);

      // Quando (Act)
      const resultado = conferirEstacao(ESTACAO, RECEBIDO, RECEBIDO);

      // Então (Assert)
      await expect(resultado).rejects.toBe(BANCO_FORA);
    });

    it("deve aceitar com o último cadastro lido quando o banco falha e a estação já foi vista Ativa", async () => {
      // Dado (Arrange)
      buscar.mockResolvedValueOnce({ status: "Ativa", criado_em: CADASTRO }).mockRejectedValue(BANCO_FORA);
      await conferirEstacao(ESTACAO, RECEBIDO, RECEBIDO);

      // Quando (Act)
      const motivo = await conferirEstacao(ESTACAO, RECEBIDO, RECEBIDO);

      // Então (Assert)
      expect(motivo).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        "PostgreSQL indisponível: usando o último cadastro lido da estação",
        { estacaoId: ESTACAO, erro: "connection refused" },
      );
    });

    it("deve recusar como inativa com o último cadastro lido quando o banco falha e a estação foi vista Inativa", async () => {
      // Dado (Arrange)
      buscar.mockResolvedValueOnce({ status: "Inativa", criado_em: CADASTRO }).mockRejectedValue(BANCO_FORA);
      await conferirEstacao(ESTACAO, RECEBIDO, RECEBIDO);

      // Quando (Act)
      const motivo = await conferirEstacao(ESTACAO, RECEBIDO, RECEBIDO);

      // Então (Assert)
      expect(motivo).toBe("Estação inativa");
    });

    it("deve usar o criado_em guardado na regra de horário quando o banco falha", async () => {
      // Dado (Arrange)
      buscar.mockResolvedValueOnce({ status: "Ativa", criado_em: CADASTRO }).mockRejectedValue(BANCO_FORA);
      await conferirEstacao(ESTACAO, RECEBIDO, RECEBIDO);

      // Quando (Act)
      const motivo = await conferirEstacao(ESTACAO, "2025-12-31T23:59:59Z", RECEBIDO);

      // Então (Assert)
      expect(motivo).toBe("Timestamp fora da faixa");
    });

    it("deve usar o banco, e não o cache, quando ele responde", async () => {
      // Dado (Arrange)
      buscar
        .mockResolvedValueOnce({ status: "Ativa", criado_em: CADASTRO })
        .mockResolvedValueOnce({ status: "Inativa", criado_em: CADASTRO });
      await conferirEstacao(ESTACAO, RECEBIDO, RECEBIDO);

      // Quando (Act)
      const motivo = await conferirEstacao(ESTACAO, RECEBIDO, RECEBIDO);

      // Então (Assert)
      expect(motivo).toBe("Estação inativa");
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("deve esquecer a estação, e propagar o erro depois, quando o banco responde que ela não existe mais", async () => {
      // Dado (Arrange)
      buscar
        .mockResolvedValueOnce({ status: "Ativa", criado_em: CADASTRO })
        .mockResolvedValueOnce(null)
        .mockRejectedValue(BANCO_FORA);
      await conferirEstacao(ESTACAO, RECEBIDO, RECEBIDO);
      await conferirEstacao(ESTACAO, RECEBIDO, RECEBIDO);

      // Quando (Act)
      const resultado = conferirEstacao(ESTACAO, RECEBIDO, RECEBIDO);

      // Então (Assert)
      await expect(resultado).rejects.toBe(BANCO_FORA);
    });
  });
});

describe("limparCadastrosConhecidos", () => {
  it("deve fazer o banco fora voltar a ser erro temporário quando o cache é limpo", async () => {
    // Dado (Arrange)
    buscar.mockResolvedValueOnce({ status: "Ativa", criado_em: CADASTRO }).mockRejectedValue(BANCO_FORA);
    await conferirEstacao(ESTACAO, RECEBIDO, RECEBIDO);

    // Quando (Act)
    limparCadastrosConhecidos();

    // Então (Assert)
    await expect(conferirEstacao(ESTACAO, RECEBIDO, RECEBIDO)).rejects.toBe(BANCO_FORA);
  });
});
