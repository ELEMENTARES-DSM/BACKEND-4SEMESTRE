import { describe, it, expect, beforeEach } from "@jest/globals";
import {
  DuplicateMetricsService,
  duplicateMetricsService,
} from "../../services/duplicate-metrics.service";

describe("DuplicateMetricsService", () => {
  let service: DuplicateMetricsService;

  beforeEach(() => {
    service = new DuplicateMetricsService();
    duplicateMetricsService.reset();
  });

  it("deve começar em 0", () => {
    expect(service.obterTotal()).toBe(0);
    expect(duplicateMetricsService.obterTotal()).toBe(0);
  });

  it("deve incrementar o total", () => {
    service.incrementar();
    expect(service.obterTotal()).toBe(1);

    service.incrementar();
    expect(service.obterTotal()).toBe(2);
  });

  it("deve voltar a 0 ao executar reset()", () => {
    service.incrementar();
    service.incrementar();

    service.reset();

    expect(service.obterTotal()).toBe(0);
  });

  it("uma instância nova deve começar em 0 mesmo com outra já incrementada", () => {
    service.incrementar();

    expect(new DuplicateMetricsService().obterTotal()).toBe(0);
  });

  it("deve contar exatamente 1000 chamadas", () => {
    for (let i = 0; i < 1000; i++) {
      service.incrementar();
    }

    expect(service.obterTotal()).toBe(1000);
  });
});
