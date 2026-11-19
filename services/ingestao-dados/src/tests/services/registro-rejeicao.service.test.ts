import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { registrarRejeicao, RegistroRejeicaoDeps } from "../../services/registro-rejeicao.service";
import { RejectionMetricsService, rejectionMetricsService } from "../../services/rejection-metrics.service";
import { logger } from "../../utils/logger";
import { PAYLOAD_MALFORMADO, TIMESTAMP_INVALIDO, ESTACAO_DESCONHECIDA } from "../../validations/motivos-rejeicao";

// Unitário de registrarRejeicao: log injetado como mock; o contador em memória
// pode ser real (interno) ou mock.
describe("registrarRejeicao", () => {
  const criarDeps = () => {
    const mockLogger = { warn: jest.fn() };
    const mockMetricas = { incrementarRejeicao: jest.fn() };
    const deps: RegistroRejeicaoDeps = { logger: mockLogger, metricas: mockMetricas };
    return { mockLogger, mockMetricas, deps };
  };

  beforeEach(() => {
    rejectionMetricsService.reset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("deve emitir WARN com o motivo e o estacaoId quando o estacaoId é informado", () => {
    // Dado (Arrange)
    const { mockLogger, deps } = criarDeps();

    // Quando (Act)
    registrarRejeicao(PAYLOAD_MALFORMADO, "estacao-abc-123", deps);

    // Então (Assert)
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(PAYLOAD_MALFORMADO, { estacaoId: "estacao-abc-123" });
  });

  it("deve emitir WARN só com o motivo quando o estacaoId não é informado", () => {
    // Dado (Arrange)
    const { mockLogger, deps } = criarDeps();

    // Quando (Act)
    registrarRejeicao(TIMESTAMP_INVALIDO, deps);

    // Então (Assert)
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(TIMESTAMP_INVALIDO);
  });

  it("deve incrementar uma vez o motivo informado quando o contador é injetado", () => {
    // Dado (Arrange)
    const { mockMetricas, deps } = criarDeps();

    // Quando (Act)
    registrarRejeicao(PAYLOAD_MALFORMADO, deps);

    // Então (Assert)
    expect(mockMetricas.incrementarRejeicao).toHaveBeenCalledTimes(1);
    expect(mockMetricas.incrementarRejeicao).toHaveBeenCalledWith(PAYLOAD_MALFORMADO);
  });

  it("deve contar só o motivo informado quando o contador injetado é o real", () => {
    // Dado (Arrange)
    const metricas = new RejectionMetricsService();
    const deps: RegistroRejeicaoDeps = { logger: { warn: jest.fn() }, metricas };

    // Quando (Act)
    registrarRejeicao(ESTACAO_DESCONHECIDA, "estacao-999", deps);

    // Então (Assert)
    expect(metricas.obterMetricas()).toEqual({ [ESTACAO_DESCONHECIDA]: 1 });
  });

  it("deve usar o logger e o contador padrão quando as dependências não são informadas", () => {
    // Dado (Arrange)
    const warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);

    // Quando (Act)
    registrarRejeicao(PAYLOAD_MALFORMADO, "estacao-padrao");
    registrarRejeicao(PAYLOAD_MALFORMADO);

    // Então (Assert)
    expect(warn).toHaveBeenNthCalledWith(1, PAYLOAD_MALFORMADO, { estacaoId: "estacao-padrao" });
    expect(warn).toHaveBeenNthCalledWith(2, PAYLOAD_MALFORMADO);
    expect(rejectionMetricsService.obterMetricas()[PAYLOAD_MALFORMADO]).toBe(2);
  });
});
