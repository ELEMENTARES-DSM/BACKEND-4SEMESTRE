import { describe, it, expect, beforeEach } from "@jest/globals";
import {
  ReceivedMetricsService,
  receivedMetricsService,
} from "../../services/received-metrics.service";

describe("ReceivedMetricsService", () => {
  let service: ReceivedMetricsService;

  beforeEach(() => {
    service = new ReceivedMetricsService();
    receivedMetricsService.reset();
  });

  it("deve começar em 0", () => {
    expect(service.obterTotal()).toBe(0);
    expect(receivedMetricsService.obterTotal()).toBe(0);
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

    expect(new ReceivedMetricsService().obterTotal()).toBe(0);
  });
});
