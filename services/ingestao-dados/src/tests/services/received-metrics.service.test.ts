import { describe, it, expect, beforeEach } from "@jest/globals";
import { ReceivedMetricsService } from "../../services/received-metrics.service";

// Unitário de ReceivedMetricsService: contador em memória, sem recurso externo.
describe("ReceivedMetricsService", () => {
  let service: ReceivedMetricsService;

  beforeEach(() => {
    service = new ReceivedMetricsService();
  });

  describe("obterTotal", () => {
    it("deve devolver 0 quando a instância é nova, mesmo com outra já incrementada", () => {
      // Dado (Arrange)
      service.incrementar();

      // Quando (Act)
      const total = new ReceivedMetricsService().obterTotal();

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
  });

  describe("reset", () => {
    it("deve voltar o total a 0 quando há leituras contadas", () => {
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
