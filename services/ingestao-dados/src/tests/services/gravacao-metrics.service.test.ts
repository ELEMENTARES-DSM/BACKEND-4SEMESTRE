import { describe, it, expect, beforeEach } from "@jest/globals";
import { GravacaoMetricsService, gravacaoMetricsService } from "../../services/gravacao-metrics.service";

// Unitário de GravacaoMetricsService: contadores em memória, sem recurso externo.
describe("GravacaoMetricsService", () => {
  let metricas: GravacaoMetricsService;

  beforeEach(() => {
    metricas = new GravacaoMetricsService();
  });

  describe("obterMensagensGravadas", () => {
    it("deve devolver 0 quando nada foi gravado", () => {
      // Dado (Arrange)
      // Quando (Act)
      const total = metricas.obterMensagensGravadas();

      // Então (Assert)
      expect(total).toBe(0);
    });
  });

  describe("obterRejeitadasGravadas", () => {
    it("deve devolver 0 quando nada foi gravado", () => {
      // Dado (Arrange)
      // Quando (Act)
      const total = metricas.obterRejeitadasGravadas();

      // Então (Assert)
      expect(total).toBe(0);
    });
  });

  describe("incrementarGravada", () => {
    it("deve somar só em mensagensGravadas quando uma aceita é gravada", () => {
      // Dado (Arrange)
      metricas.incrementarGravada();

      // Quando (Act)
      metricas.incrementarGravada();

      // Então (Assert)
      expect(metricas.obterMensagensGravadas()).toBe(2);
      expect(metricas.obterRejeitadasGravadas()).toBe(0);
    });
  });

  describe("incrementarRejeitadaGravada", () => {
    it("deve somar só em rejeitadasGravadas quando uma recusada é gravada", () => {
      // Dado (Arrange)
      // Quando (Act)
      metricas.incrementarRejeitadaGravada();

      // Então (Assert)
      expect(metricas.obterRejeitadasGravadas()).toBe(1);
      expect(metricas.obterMensagensGravadas()).toBe(0);
    });
  });

  describe("reset", () => {
    it("deve zerar os dois contadores quando há gravações contadas", () => {
      // Dado (Arrange)
      metricas.incrementarGravada();
      metricas.incrementarRejeitadaGravada();

      // Quando (Act)
      metricas.reset();

      // Então (Assert)
      expect(metricas.obterMensagensGravadas()).toBe(0);
      expect(metricas.obterRejeitadasGravadas()).toBe(0);
    });
  });
});

describe("gravacaoMetricsService", () => {
  it("deve ser uma instância de GravacaoMetricsService quando a rota de métricas a importa", () => {
    // Dado (Arrange)
    // Quando (Act)
    const instancia = gravacaoMetricsService;

    // Então (Assert)
    expect(instancia).toBeInstanceOf(GravacaoMetricsService);
  });
});
