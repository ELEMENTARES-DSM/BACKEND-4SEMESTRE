import { describe, it, expect, jest } from "@jest/globals";
import { Writable } from "node:stream";
import { Request, Response } from "express";
import { listarMedicoes } from "../../controllers/medicoes.controller";
import { escreverCsv } from "../../services/gerar-csv.service";
import { municipioDoPedido } from "../../services/municipio-do-pedido";
import logger from "../../utils/logger";

jest.mock("../../repositories/medicoes.repository");
jest.mock("../../services/gerar-csv.service");
jest.mock("../../services/municipio-do-pedido");

function respostaFalsa() {
  const res = {
    set: jest.fn(),
    status: jest.fn(),
    json: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
    destroy: jest.fn(),
  };
  res.set.mockReturnValue(res);
  res.status.mockReturnValue(res);
  return res;
}

describe("US-31 · TASK 31.03 · erro no meio do CSV", () => {
  it("deve registrar o erro no log e encerrar a conexão quando a geração do CSV falha depois de começar", async () => {
    // Dado
    const req = {
      query: { inicio: "2026-11-06", fim: "2026-11-06", formato: "csv" },
      usuario: { id: "gestor-1", papel: "GESTOR_PUBLICO", municipio: "São José dos Campos" },
    } as unknown as Request;
    const res = respostaFalsa();
    jest.mocked(municipioDoPedido).mockResolvedValue("São José dos Campos");
    jest.mocked(escreverCsv).mockImplementation(async (_filtros, saida: Writable) => {
      saida.write("lido_em;estacao_codigo\r\n");
      throw new Error("Conexão com o PostgreSQL perdida");
    });
    const logErro = jest.spyOn(logger, "error").mockImplementation(() => undefined);

    // Quando
    await listarMedicoes(req, res as unknown as Response);

    // Então
    expect(res.write).toHaveBeenCalledTimes(1);
    expect(logErro).toHaveBeenCalledWith("Falha ao gerar o CSV das medições", {
      municipio: "São José dos Campos",
      inicio: "2026-11-06",
      fim: "2026-11-06",
      erro: "Conexão com o PostgreSQL perdida",
    });
    expect(res.destroy).toHaveBeenCalledTimes(1);
    expect(res.end).not.toHaveBeenCalled();
  });
});
