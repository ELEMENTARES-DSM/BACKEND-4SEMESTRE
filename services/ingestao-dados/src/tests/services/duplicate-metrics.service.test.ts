import { describe, it, expect, beforeEach } from "@jest/globals";
import { DuplicateMetricsService } from "../../services/duplicate-metrics.service";

// Unitário de DuplicateMetricsService: contador em memória, sem recurso externo.
describe("DuplicateMetricsService", () => {
  let service: DuplicateMetricsService;

  beforeEach(() => {
    service = new DuplicateMetricsService();
  });

  describe("obterTotal", () => {
    it("deve devolver 0 quando a instância é nova, mesmo com outra já incrementada", () => {
      // Dado (Arrange)
      service.incrementar();

      // Quando (Act)
      const total = new DuplicateMetricsService().obterTotal();

      // Então (Assert)
      expect(total).toBe(0);
    });
  });

  describe("incrementar", () => {
    it("deve somar 1 ao total quando é chamado", () => {
      // Dado (Arrange)
      service.incrementar();

      // Quando (Act)
      service.incrementar();

      // Então (Assert)
      expect(service.obterTotal()).toBe(2);
    });

    it("deve contar exatamente 1000 quando é chamado 1000 vezes", () => {
      // Dado (Arrange)
      const vezes = 1000;

      // Quando (Act)
      for (let i = 0; i < vezes; i++) service.incrementar();

      // Então (Assert)
      expect(service.obterTotal()).toBe(1000);
    });
  });

  describe("reset", () => {
    it("deve voltar o total a 0 quando há duplicatas contadas", () => {
      // Dado (Arrange)
      service.incrementar();
      service.incrementar();

      // Quando (Act)
      service.reset();

      // Então (Assert)
      expect(service.obterTotal()).toBe(0);
    });
  });
});
