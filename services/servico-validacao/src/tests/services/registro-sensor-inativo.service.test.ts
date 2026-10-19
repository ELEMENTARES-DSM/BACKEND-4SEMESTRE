import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import {
  MENSAGEM_LEITURA_SENSOR_INATIVO,
  registrarLeituraSensorInativo,
  RegistroSensorInativoDeps,
} from "../../services/registro-sensor-inativo.service";
import { sensorInativoMetricsService } from "../../services/sensor-inativo-metrics.service";
import { logger } from "../../utils/logger";

describe("registroSensorInativoService", () => {
  const dados = {
    estacaoId: "e30a57e3-0d33-4f9e-86b2-6cb1690a7891",
    codigo: "PM-01",
    unixtime: 1792411200,
    valorBruto: 12.5,
  };
  const contextoEsperado = {
    estacaoId: dados.estacaoId,
    codigo: "PM-01",
    horario: "2026-10-19T12:00:00.000Z",
    valorBruto: 12.5,
  };

  beforeEach(() => {
    sensorInativoMetricsService.reset();
    jest.restoreAllMocks();
  });

  const criarDeps = () => {
    const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const mockMetricas = { incrementar: jest.fn() };
    const deps: RegistroSensorInativoDeps = { logger: mockLogger, metricas: mockMetricas };
    return { mockLogger, mockMetricas, deps };
  };

  it("deve emitir WARN 1 vez com a mensagem e o contexto exatos (horario em ISO)", () => {
    const { mockLogger, deps } = criarDeps();

    registrarLeituraSensorInativo(dados, deps);

    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      MENSAGEM_LEITURA_SENSOR_INATIVO,
      contextoEsperado,
    );
  });

  it("deve incrementar o contador exatamente 1 vez", () => {
    const { mockMetricas, deps } = criarDeps();

    registrarLeituraSensorInativo(dados, deps);

    expect(mockMetricas.incrementar).toHaveBeenCalledTimes(1);
  });

  it("não deve emitir error", () => {
    const { mockLogger, deps } = criarDeps();

    registrarLeituraSensorInativo(dados, deps);

    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("deve usar as dependências padrão (singleton logger e sensorInativoMetricsService) quando não fornecidas", () => {
    const spyWarn = jest.spyOn(logger, "warn").mockImplementation(() => {});

    registrarLeituraSensorInativo(dados);

    expect(spyWarn).toHaveBeenCalledWith(MENSAGEM_LEITURA_SENSOR_INATIVO, contextoEsperado);
    expect(sensorInativoMetricsService.obterTotal()).toBe(1);
  });
});
