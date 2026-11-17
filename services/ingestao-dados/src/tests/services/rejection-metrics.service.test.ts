import { describe, it, expect, beforeEach } from "@jest/globals";
import { RejectionMetricsService } from "../../services/rejection-metrics.service";

// Unitário de RejectionMetricsService: contagem em memória, sem recurso externo.
describe("RejectionMetricsService", () => {
  let service: RejectionMetricsService;

  beforeEach(() => {
    service = new RejectionMetricsService();
  });

  describe("obterMetricas", () => {
    it("deve devolver {} quando não há rejeições", () => {
      // Dado (Arrange)
      // Quando (Act)
      const metricas = service.obterMetricas();

      // Então (Assert)
      expect(metricas).toEqual({});
    });

    it("deve devolver uma cópia quando quem chamou altera o objeto devolvido", () => {
      // Dado (Arrange)
      service.incrementarRejeicao("LEITURA_INCOMPLETA");
      const copia = service.obterMetricas();
      copia.LEITURA_INCOMPLETA = 999;
      copia.NOVO_CAMPO = 50;

      // Quando (Act)
      const metricas = service.obterMetricas();

      // Então (Assert)
      expect(metricas).toEqual({ LEITURA_INCOMPLETA: 1 });
    });
  });

  describe("incrementarRejeicao", () => {
    it("deve manter a contagem exata por motivo quando há 1050 chamadas concorrentes em 3 motivos", async () => {
      // Dado (Arrange)
      const chamadas = [
        ...Array.from({ length: 400 }, () => "PAYLOAD_MALFORMADO"),
        ...Array.from({ length: 350 }, () => "TIMESTAMP_INVALIDO"),
        ...Array.from({ length: 300 }, () => "ESTACAO_DESCONHECIDA"),
      ];

      // Quando (Act)
      await Promise.all(chamadas.map(async (motivo) => service.incrementarRejeicao(motivo)));

      // Então (Assert)
      expect(service.obterMetricas()).toEqual({
        PAYLOAD_MALFORMADO: 400,
        TIMESTAMP_INVALIDO: 350,
        ESTACAO_DESCONHECIDA: 300,
      });
    });
  });

  describe("reset", () => {
    it("deve zerar todas as contagens quando há motivos contados", () => {
      // Dado (Arrange)
      service.incrementarRejeicao("MOTIVO_1");
      service.incrementarRejeicao("MOTIVO_2");

      // Quando (Act)
      service.reset();

      // Então (Assert)
      expect(service.obterMetricas()).toEqual({});
    });
  });
});
