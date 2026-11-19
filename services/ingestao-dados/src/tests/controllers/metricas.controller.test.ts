import { describe, it, expect, jest } from "@jest/globals";
import { Request, Response } from "express";
import { obterMetricas } from "../../controllers/metricas.controller";
import { lerMetricas, MetricasIngestao } from "../../repositories/staging-valkey.repository";
import { PAYLOAD_MALFORMADO } from "../../validations/motivos-rejeicao";

// Unitário de obterMetricas: a leitura do Valkey (lerMetricas) é mockada.
jest.mock("../../repositories/staging-valkey.repository", () => ({ lerMetricas: jest.fn() }));

function respostaFalsa() {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}

describe("obterMetricas", () => {
  it("deve responder 200 com as métricas lidas do Valkey quando o Valkey responde", async () => {
    // Dado (Arrange)
    const metricas: MetricasIngestao = {
      leiturasRecebidas: 5,
      leiturasRejeitadas: { [PAYLOAD_MALFORMADO]: 1 },
      duplicadasIgnoradas: 1,
      mensagensPendentes: 1,
      mensagensEncaminhadas: 2,
      pendenteMaisAntigaEm: "2026-11-16T10:00:00.000Z",
    };
    jest.mocked(lerMetricas).mockResolvedValue(metricas);
    const res = respostaFalsa();

    // Quando (Act)
    await obterMetricas({} as Request, res as unknown as Response);

    // Então (Assert)
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(metricas);
  });

  it("deve responder 500 com a mensagem de erro quando o Valkey não responde", async () => {
    // Dado (Arrange)
    jest.mocked(lerMetricas).mockRejectedValue(new Error("The client is offline"));
    const res = respostaFalsa();

    // Quando (Act)
    await obterMetricas({} as Request, res as unknown as Response);

    // Então (Assert)
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ erro: "Não foi possível consultar métricas de ingestão." });
  });
});
