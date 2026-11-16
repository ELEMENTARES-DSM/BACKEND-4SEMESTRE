import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { Request, Response } from "express";
import { obterMetricas } from "../../controllers/metricas.controller";
import { contarPendentes } from "../../repositories/staging-valkey.repository";
import { rejectionMetricsService } from "../../services/rejection-metrics.service";
import { duplicateMetricsService } from "../../services/duplicate-metrics.service";
import { receivedMetricsService } from "../../services/received-metrics.service";
import { gravacaoMetricsService } from "../../services/gravacao-metrics.service";
import { PAYLOAD_MALFORMADO } from "../../validations/motivos-rejeicao";

// Unitário de obterMetricas: o Valkey (contarPendentes) é mockado; os contadores
// em memória são internos e entram reais.
jest.mock("../../repositories/staging-valkey.repository", () => ({ contarPendentes: jest.fn() }));

function respostaFalsa() {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}

describe("obterMetricas", () => {
  beforeEach(() => {
    jest.mocked(contarPendentes).mockResolvedValue(0);
    rejectionMetricsService.reset();
    duplicateMetricsService.reset();
    receivedMetricsService.reset();
    gravacaoMetricsService.reset();
  });

  it("deve responder 200 com todos os contadores zerados e leiturasRejeitadas {} quando nada foi registrado", async () => {
    // Dado (Arrange)
    const res = respostaFalsa();

    // Quando (Act)
    await obterMetricas({} as Request, res as unknown as Response);

    // Então (Assert)
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      leiturasRecebidas: 0,
      leiturasRejeitadas: {},
      duplicadasIgnoradas: 0,
      mensagensGravadas: 0,
      rejeitadasGravadas: 0,
      mensagensPendentes: 0,
    });
  });

  it("deve devolver cada contador no seu campo quando há registros de todos os tipos", async () => {
    // Dado (Arrange)
    receivedMetricsService.incrementar();
    receivedMetricsService.incrementar();
    rejectionMetricsService.incrementarRejeicao(PAYLOAD_MALFORMADO);
    duplicateMetricsService.incrementar();
    gravacaoMetricsService.incrementarGravada();
    gravacaoMetricsService.incrementarRejeitadaGravada();
    const res = respostaFalsa();

    // Quando (Act)
    await obterMetricas({} as Request, res as unknown as Response);

    // Então (Assert)
    expect(res.json).toHaveBeenCalledWith({
      leiturasRecebidas: 2,
      leiturasRejeitadas: { [PAYLOAD_MALFORMADO]: 1 },
      duplicadasIgnoradas: 1,
      mensagensGravadas: 1,
      rejeitadasGravadas: 1,
      mensagensPendentes: 0,
    });
  });

  describe("US-40 · mensagensPendentes vem do Valkey", () => {
    it("deve devolver mensagensPendentes com o tamanho de staging:pendentes quando há pendentes", async () => {
      // Dado (Arrange)
      jest.mocked(contarPendentes).mockResolvedValue(3);
      const res = respostaFalsa();

      // Quando (Act)
      await obterMetricas({} as Request, res as unknown as Response);

      // Então (Assert)
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ mensagensPendentes: 3 }));
    });

    it("deve responder 500 com a mensagem de erro quando o Valkey não responde", async () => {
      // Dado (Arrange)
      jest.mocked(contarPendentes).mockRejectedValue(new Error("The client is offline"));
      const res = respostaFalsa();

      // Quando (Act)
      await obterMetricas({} as Request, res as unknown as Response);

      // Então (Assert)
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ erro: "Não foi possível consultar métricas de ingestão." });
    });
  });
});
