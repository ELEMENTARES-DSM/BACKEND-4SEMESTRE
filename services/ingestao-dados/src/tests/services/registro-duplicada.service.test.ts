import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import {
  registrarDuplicadaIgnorada,
  MENSAGEM_DUPLICADA_IGNORADA,
  RegistroDuplicadaDeps,
} from "../../services/registro-duplicada.service";
import { duplicateMetricsService } from "../../services/duplicate-metrics.service";
import { rejectionMetricsService } from "../../services/rejection-metrics.service";
import { logger } from "../../utils/logger";

// Unitário de registrarDuplicadaIgnorada: log e contador injetados como mocks.
describe("registrarDuplicadaIgnorada", () => {
  const dados = { estacaoId: "e30a57e3-0d33-4f9e-86b2-6cb1690a7891", timestamp: "2026-10-14T12:00:00Z" };

  const criarDeps = () => {
    const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const mockMetricas = { incrementar: jest.fn() };
    const deps: RegistroDuplicadaDeps = { logger: mockLogger, metricas: mockMetricas };
    return { mockLogger, mockMetricas, deps };
  };

  beforeEach(() => {
    duplicateMetricsService.reset();
    rejectionMetricsService.reset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("deve emitir INFO uma vez com a mensagem e o contexto exatos quando a duplicata é ignorada", () => {
    // Dado (Arrange)
    const { mockLogger, deps } = criarDeps();

    // Quando (Act)
    registrarDuplicadaIgnorada(dados, deps);

    // Então (Assert)
    expect(mockLogger.info).toHaveBeenCalledTimes(1);
    expect(mockLogger.info).toHaveBeenCalledWith(MENSAGEM_DUPLICADA_IGNORADA, dados);
  });

  it("deve incrementar o contador de duplicadas uma vez quando a duplicata é ignorada", () => {
    // Dado (Arrange)
    const { mockMetricas, deps } = criarDeps();

    // Quando (Act)
    registrarDuplicadaIgnorada(dados, deps);

    // Então (Assert)
    expect(mockMetricas.incrementar).toHaveBeenCalledTimes(1);
  });

  it("deve não emitir WARN nem ERROR quando a duplicata é ignorada, porque duplicata não é erro", () => {
    // Dado (Arrange)
    const { mockLogger, deps } = criarDeps();

    // Quando (Act)
    registrarDuplicadaIgnorada(dados, deps);

    // Então (Assert)
    expect(mockLogger.warn).not.toHaveBeenCalled();
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("deve não contar como rejeição quando a duplicata é ignorada", () => {
    // Dado (Arrange)
    const { deps } = criarDeps();

    // Quando (Act)
    registrarDuplicadaIgnorada(dados, deps);

    // Então (Assert)
    expect(rejectionMetricsService.obterMetricas()).toEqual({});
  });

  it("deve usar o logger e o contador padrão quando as dependências não são informadas", () => {
    // Dado (Arrange)
    const info = jest.spyOn(logger, "info").mockImplementation(() => undefined);

    // Quando (Act)
    registrarDuplicadaIgnorada(dados);

    // Então (Assert)
    expect(info).toHaveBeenCalledWith(MENSAGEM_DUPLICADA_IGNORADA, dados);
    expect(duplicateMetricsService.obterTotal()).toBe(1);
  });
});
