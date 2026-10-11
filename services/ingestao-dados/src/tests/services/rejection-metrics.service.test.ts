import { describe, it, expect, beforeEach } from "@jest/globals";
import {
  RejectionMetricsService,
  rejectionMetricsService,
} from "../../services/rejection-metrics.service";


describe("RejectionMetricsService", () => {
  let service: RejectionMetricsService;

  beforeEach(() => {
    service = new RejectionMetricsService();
    rejectionMetricsService.reset();
  });

  it("deve devolver {} quando não há registros", () => {
    expect(service.obterMetricas()).toEqual({});
    expect(rejectionMetricsService.obterMetricas()).toEqual({});
  });

  it("deve disparar pelo menos 1000 chamadas concorrentes distribuídas em 3 motivos e manter a contagem exata", async () => {
    const motivoA = "PAYLOAD_MALFORMADO";
    const motivoB = "TIMESTAMP_INVALIDO";
    const motivoC = "ESTACAO_DESCONHECIDA";

    const totalA = 400;
    const totalB = 350;
    const totalC = 300;
    const totalChamadas = totalA + totalB + totalC; // 1050 chamadas (> 1000)

    const chamadas: Promise<void>[] = [];

    for (let i = 0; i < totalA; i++) {
      chamadas.push(
        (async () => {
          service.incrementarRejeicao(motivoA);
        })(),
      );
    }

    for (let i = 0; i < totalB; i++) {
      chamadas.push(
        (async () => {
          service.incrementarRejeicao(motivoB);
        })(),
      );
    }

    for (let i = 0; i < totalC; i++) {
      chamadas.push(
        (async () => {
          service.incrementarRejeicao(motivoC);
        })(),
      );
    }

    expect(chamadas.length).toBe(totalChamadas);
    expect(chamadas.length).toBeGreaterThanOrEqual(1000);

    await Promise.all(chamadas);

    const metricas = service.obterMetricas();
    expect(metricas[motivoA]).toBe(totalA);
    expect(metricas[motivoB]).toBe(totalB);
    expect(metricas[motivoC]).toBe(totalC);
    expect(Object.keys(metricas)).toHaveLength(3);
  });

  it("deve garantir que obterMetricas devolve uma cópia e alterações no objeto não mudam o estado interno", () => {
    const motivo = "LEITURA_INCOMPLETA";
    service.incrementarRejeicao(motivo);

    const copia1 = service.obterMetricas();
    expect(copia1[motivo]).toBe(1);

    // Modificando a cópia retornada
    copia1[motivo] = 999;
    copia1["NOVO_CAMPO"] = 50;

    const copia2 = service.obterMetricas();
    expect(copia2[motivo]).toBe(1);
    expect(copia2["NOVO_CAMPO"]).toBeUndefined();
  });

  it("deve zerar todas as contagens ao executar reset()", () => {
    service.incrementarRejeicao("MOTIVO_1");
    service.incrementarRejeicao("MOTIVO_2");

    expect(Object.keys(service.obterMetricas())).toHaveLength(2);

    service.reset();

    expect(service.obterMetricas()).toEqual({});
  });
});
