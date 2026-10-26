import { describe, it, expect, beforeEach } from "@jest/globals";
import {
  MetricasValidacaoService,
  metricasValidacaoService,
} from "../../services/metricas-validacao.service";

describe("MetricasValidacaoService", () => {
  let metricas: MetricasValidacaoService;

  beforeEach(() => {
    metricas = new MetricasValidacaoService();
  });

  it("começa com os contadores em 0", () => {
    expect(metricas.obterMetricas()).toEqual({
      leiturasIgnoradasSensorInativo: 0,
      medidasInvalidasGravadas: 0,
    });
  });

  it("soma 1 por padrão e a quantidade informada", () => {
    metricas.incrementarIgnoradasSensorInativo();
    metricas.incrementarIgnoradasSensorInativo(2);

    expect(metricas.obterMetricas().leiturasIgnoradasSensorInativo).toBe(3);
  });

  it("conta as medidas inválidas gravadas separadamente (US-19)", () => {
    metricas.incrementarMedidasInvalidasGravadas();
    metricas.incrementarMedidasInvalidasGravadas(2);

    expect(metricas.obterMetricas()).toEqual({
      leiturasIgnoradasSensorInativo: 0,
      medidasInvalidasGravadas: 3,
    });
  });

  it("reset zera os contadores", () => {
    metricas.incrementarIgnoradasSensorInativo(5);
    metricas.incrementarMedidasInvalidasGravadas(2);
    metricas.reset();

    expect(metricas.obterMetricas()).toEqual({
      leiturasIgnoradasSensorInativo: 0,
      medidasInvalidasGravadas: 0,
    });
  });

  it("exporta uma instância única usada pela rota de métricas", () => {
    expect(metricasValidacaoService).toBeInstanceOf(MetricasValidacaoService);
  });
});
