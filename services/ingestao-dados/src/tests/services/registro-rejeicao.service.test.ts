import { describe, it, expect, jest, afterEach } from "@jest/globals";
import { registrarRejeicao } from "../../services/registro-rejeicao.service";
import { logger } from "../../utils/logger";
import { PAYLOAD_MALFORMADO, TIMESTAMP_INVALIDO } from "../../validations/motivos-rejeicao";

// Unitário de registrarRejeicao: log injetado como mock. O contador por motivo
// fica no Valkey (staging-valkey.repository).
describe("registrarRejeicao", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("deve emitir WARN com o motivo e o estacaoId quando o estacaoId é informado", () => {
    // Dado (Arrange)
    const mockLogger = { warn: jest.fn() };

    // Quando (Act)
    registrarRejeicao(PAYLOAD_MALFORMADO, "estacao-abc-123", { logger: mockLogger });

    // Então (Assert)
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(PAYLOAD_MALFORMADO, { estacaoId: "estacao-abc-123" });
  });

  it("deve emitir WARN só com o motivo quando o estacaoId não é informado", () => {
    // Dado (Arrange)
    const mockLogger = { warn: jest.fn() };

    // Quando (Act)
    registrarRejeicao(TIMESTAMP_INVALIDO, { logger: mockLogger });

    // Então (Assert)
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(TIMESTAMP_INVALIDO);
  });

  it("deve usar o logger padrão quando as dependências não são informadas", () => {
    // Dado (Arrange)
    const warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);

    // Quando (Act)
    registrarRejeicao(PAYLOAD_MALFORMADO, "estacao-padrao");
    registrarRejeicao(PAYLOAD_MALFORMADO);

    // Então (Assert)
    expect(warn).toHaveBeenNthCalledWith(1, PAYLOAD_MALFORMADO, { estacaoId: "estacao-padrao" });
    expect(warn).toHaveBeenNthCalledWith(2, PAYLOAD_MALFORMADO);
  });
});
