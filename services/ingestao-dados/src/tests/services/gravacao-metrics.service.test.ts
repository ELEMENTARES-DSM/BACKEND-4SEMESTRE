import { describe, it, expect, beforeEach } from "@jest/globals";
import {
  GravacaoMetricsService,
  gravacaoMetricsService,
} from "../../services/gravacao-metrics.service";

describe("GravacaoMetricsService (TASK 14.03)", () => {
  let metricas: GravacaoMetricsService;

  beforeEach(() => {
    metricas = new GravacaoMetricsService();
  });

  it("começa com os dois contadores em 0", () => {
    expect(metricas.obterMensagensGravadas()).toBe(0);
    expect(metricas.obterRejeitadasGravadas()).toBe(0);
  });

  it("conta aceitas e rejeitadas gravadas separadamente", () => {
    metricas.incrementarGravada();
    metricas.incrementarGravada();
    metricas.incrementarRejeitadaGravada();

    expect(metricas.obterMensagensGravadas()).toBe(2);
    expect(metricas.obterRejeitadasGravadas()).toBe(1);
  });

  it("reset zera os dois contadores", () => {
    metricas.incrementarGravada();
    metricas.incrementarRejeitadaGravada();

    metricas.reset();

    expect(metricas.obterMensagensGravadas()).toBe(0);
    expect(metricas.obterRejeitadasGravadas()).toBe(0);
  });

  it("exporta uma instância única usada pela rota de métricas", () => {
    expect(gravacaoMetricsService).toBeInstanceOf(GravacaoMetricsService);
  });
});
