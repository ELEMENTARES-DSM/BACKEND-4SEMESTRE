import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import {
  registrarDuplicadaIgnorada,
  MENSAGEM_DUPLICADA_IGNORADA,
  RegistroDuplicadaDeps,
} from "../../services/registro-duplicada.service";
import { duplicateMetricsService } from "../../services/duplicate-metrics.service";
import { rejectionMetricsService } from "../../services/rejection-metrics.service";
import { logger } from "../../utils/logger";

describe("registroDuplicadaService", () => {
  const dados = {
    estacaoId: "e30a57e3-0d33-4f9e-86b2-6cb1690a7891",
    timestamp: "2026-10-14T12:00:00Z",
  };

  beforeEach(() => {
    duplicateMetricsService.reset();
    rejectionMetricsService.reset();
    jest.restoreAllMocks();
  });

  const criarDeps = () => {
    const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const mockMetricas = { incrementar: jest.fn() };
    const deps: RegistroDuplicadaDeps = { logger: mockLogger, metricas: mockMetricas };
    return { mockLogger, mockMetricas, deps };
  };

  it("deve emitir INFO 1 vez com a mensagem e o contexto exatos", () => {
    const { mockLogger, deps } = criarDeps();

    registrarDuplicadaIgnorada(dados, deps);

    expect(mockLogger.info).toHaveBeenCalledTimes(1);
    expect(mockLogger.info).toHaveBeenCalledWith(MENSAGEM_DUPLICADA_IGNORADA, {
      estacaoId: dados.estacaoId,
      timestamp: dados.timestamp,
    });
  });

  it("deve incrementar o contador exatamente 1 vez", () => {
    const { mockMetricas, deps } = criarDeps();

    registrarDuplicadaIgnorada(dados, deps);

    expect(mockMetricas.incrementar).toHaveBeenCalledTimes(1);
  });

  it("não deve emitir warn nem error", () => {
    const { mockLogger, deps } = criarDeps();

    registrarDuplicadaIgnorada(dados, deps);

    expect(mockLogger.warn).not.toHaveBeenCalled();
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("não deve contar como rejeição", () => {
    const { deps } = criarDeps();

    registrarDuplicadaIgnorada(dados, deps);

    expect(rejectionMetricsService.obterMetricas()).toEqual({});
  });

  it("deve usar as dependências padrão (singleton logger e duplicateMetricsService) quando não fornecidas", () => {
    const spyInfo = jest.spyOn(logger, "info").mockImplementation(() => {});

    registrarDuplicadaIgnorada(dados);

    expect(spyInfo).toHaveBeenCalledWith(MENSAGEM_DUPLICADA_IGNORADA, dados);
    expect(duplicateMetricsService.obterTotal()).toBe(1);
    expect(rejectionMetricsService.obterMetricas()).toEqual({});
  });
});
