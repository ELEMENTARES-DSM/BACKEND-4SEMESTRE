import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import {
  registrarRejeicao,
  RegistroRejeicaoDeps,
} from "../../services/registro-rejeicao.service";

import {
  RejectionMetricsService,
  rejectionMetricsService,
} from "../../services/rejection-metrics.service";
import { logger } from "../../utils/logger";
import {
  PAYLOAD_MALFORMADO,
  TIMESTAMP_INVALIDO,
  ESTACAO_DESCONHECIDA,
  MOTIVOS_REJEICAO,
} from "../../validations/motivos-rejeicao";

describe("registroRejeicaoService", () => {
  beforeEach(() => {
    rejectionMetricsService.reset();
    jest.restoreAllMocks();
  });

  it("deve emitir WARN com a mensagem exata e o estacaoId quando estacaoId for informado", () => {
    const mockLogger = {
      warn: jest.fn(),
    };
    const mockMetricas = {
      incrementarRejeicao: jest.fn(),
    };
    const deps: RegistroRejeicaoDeps = {
      logger: mockLogger,
      metricas: mockMetricas,
    };

    const estacaoId = "estacao-abc-123";
    registrarRejeicao(PAYLOAD_MALFORMADO, estacaoId, deps);

    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(PAYLOAD_MALFORMADO, {
      estacaoId,
    });
  });

  it("deve emitir WARN sem o campo de estação no contexto quando estacaoId não for informado", () => {
    const mockLogger = {
      warn: jest.fn(),
    };
    const mockMetricas = {
      incrementarRejeicao: jest.fn(),
    };
    const deps: RegistroRejeicaoDeps = {
      logger: mockLogger,
      metricas: mockMetricas,
    };

    registrarRejeicao(TIMESTAMP_INVALIDO, deps);

    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(TIMESTAMP_INVALIDO);
    // Garante que não foi passado segundo argumento com estacaoId
    expect(mockLogger.warn).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ estacaoId: expect.anything() }),
    );
  });

  it("deve incrementar exatamente uma vez o motivo informado usando RejectionMetricsService real", () => {
    const mockLogger = {
      warn: jest.fn(),
    };
    const realMetricas = new RejectionMetricsService();
    const deps: RegistroRejeicaoDeps = {
      logger: mockLogger,
      metricas: realMetricas,
    };

    registrarRejeicao(ESTACAO_DESCONHECIDA, "estacao-999", deps);

    const metricas = realMetricas.obterMetricas();
    expect(metricas[ESTACAO_DESCONHECIDA]).toBe(1);
    expect(Object.keys(metricas)).toHaveLength(1);
  });

  it("deve incrementar exatamente uma vez o mock de métricas com o motivo fornecido", () => {
    const mockLogger = {
      warn: jest.fn(),
    };
    const mockMetricas = {
      incrementarRejeicao: jest.fn(),
    };
    const deps: RegistroRejeicaoDeps = {
      logger: mockLogger,
      metricas: mockMetricas,
    };

    registrarRejeicao(PAYLOAD_MALFORMADO, deps);

    expect(mockMetricas.incrementarRejeicao).toHaveBeenCalledTimes(1);
    expect(mockMetricas.incrementarRejeicao).toHaveBeenCalledWith(PAYLOAD_MALFORMADO);
  });

  it("deve usar as dependências padrão (singleton logger e rejectionMetricsService) quando não fornecidas", () => {
    const spyWarn = jest.spyOn(logger, "warn").mockImplementation(() => {});
    const spyIncrementar = jest.spyOn(rejectionMetricsService, "incrementarRejeicao");

    const motivo = MOTIVOS_REJEICAO[0];
    registrarRejeicao(motivo, "estacao-padrao");

    expect(spyWarn).toHaveBeenCalledWith(motivo, { estacaoId: "estacao-padrao" });
    expect(spyIncrementar).toHaveBeenCalledWith(motivo);
    expect(rejectionMetricsService.obterMetricas()[motivo]).toBe(1);

    registrarRejeicao(motivo);
    expect(spyWarn).toHaveBeenCalledWith(motivo);
    expect(rejectionMetricsService.obterMetricas()[motivo]).toBe(2);
  });
});
