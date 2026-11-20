import { describe, it, expect, jest, afterEach } from "@jest/globals";
import { Writable } from "node:stream";
import { Request, Response } from "express";
import { listarMedicoes } from "../../controllers/medicoes.controller";
import {
  buscarMedicoes,
  contarMedicoes,
  LinhaMedicao,
} from "../../repositories/medicoes.repository";
import { escreverCsv } from "../../services/gerar-csv.service";
import { ErroPedido, municipioDoPedido } from "../../services/municipio-do-pedido";
import logger from "../../utils/logger";

jest.mock("../../repositories/medicoes.repository");
jest.mock("../../services/gerar-csv.service");
jest.mock("../../services/municipio-do-pedido", () => {
  const atual = jest.requireActual<typeof import("../../services/municipio-do-pedido")>(
    "../../services/municipio-do-pedido",
  );
  return {
    ...atual,
    municipioDoPedido: jest.fn(),
  };
});

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

const linhaPadrao: LinhaMedicao = {
  id: "0b6f6c1e-3c1a-4c55-9a43-2f1d6c1b9f10",
  unixtime: "1793973900",
  estacao_codigo: "EST-001",
  estacao_nome: "Centro",
  municipio: "São José dos Campos",
  sensor_codigo: "T-01",
  grandeza: "Temperatura",
  unidade: "°C",
  valor: "23.400000",
  valor_bruto: "24.900000",
  valida: true,
};

describe("medicoes.controller (US-31)", () => {
  describe("listarMedicoes", () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("deve devolver 200 em JSON com Cache-Control no-store quando o pedido é válido", async () => {
      // Dado:
      const req = {
        query: { inicio: "2026-11-06", fim: "2026-11-06" },
        usuario: { id: "gestor-1", papel: "GESTOR_PUBLICO", municipio: "São José dos Campos" },
      } as unknown as Request;
      const res = respostaFalsa();
      jest.mocked(municipioDoPedido).mockResolvedValue("São José dos Campos");
      jest.mocked(contarMedicoes).mockResolvedValue(1);
      jest.mocked(buscarMedicoes).mockResolvedValue([linhaPadrao]);

      // Quando:
      await listarMedicoes(req, res as unknown as Response);

      // Então:
      expect(res.set).toHaveBeenCalledWith("Cache-Control", "no-store");
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        municipio: "São José dos Campos",
        inicio: "2026-11-06",
        fim: "2026-11-06",
        pagina: 1,
        porPagina: 500,
        total: 1,
        medicoes: [
          {
            lidoEm: "2026-11-06T14:05:00Z",
            estacaoCodigo: "EST-001",
            estacaoNome: "Centro",
            municipio: "São José dos Campos",
            sensorCodigo: "T-01",
            grandeza: "Temperatura",
            unidade: "°C",
            valor: 23.4,
            valorBruto: 24.9,
            valida: true,
          },
        ],
      });
    });

    it("deve devolver 400 com Cache-Control no-store quando os filtros são inválidos", async () => {
      // Dado:
      const req = {
        query: { inicio: "2026-11-06", fim: "2026-11-05" },
        usuario: { id: "gestor-1", papel: "GESTOR_PUBLICO", municipio: "São José dos Campos" },
      } as unknown as Request;
      const res = respostaFalsa();

      // Quando:
      await listarMedicoes(req, res as unknown as Response);

      // Então:
      expect(res.set).toHaveBeenCalledWith("Cache-Control", "no-store");
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ erro: "Período inválido: o fim é antes do início." });
      expect(municipioDoPedido).not.toHaveBeenCalled();
    });

    it("deve devolver o status do ErroPedido quando a verificação do município falha", async () => {
      // Dado:
      const req = {
        query: { inicio: "2026-11-06", fim: "2026-11-06", municipio: "São José dos Campos" },
        usuario: { id: "gestor-1", papel: "GESTOR_PUBLICO", municipio: "São Paulo" },
      } as unknown as Request;
      const res = respostaFalsa();
      jest.mocked(municipioDoPedido).mockRejectedValue(new ErroPedido(404, "Município não encontrado."));

      // Quando:
      await listarMedicoes(req, res as unknown as Response);

      // Então:
      expect(res.set).toHaveBeenCalledWith("Cache-Control", "no-store");
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ erro: "Município não encontrado." });
    });

    it("deve relançar o erro quando municipioDoPedido falha com erro inesperado", async () => {
      // Dado:
      const req = {
        query: { inicio: "2026-11-06", fim: "2026-11-06" },
        usuario: { id: "admin-1", papel: "ADMINISTRADOR", municipio: "São José dos Campos" },
      } as unknown as Request;
      const res = respostaFalsa();
      jest.mocked(municipioDoPedido).mockRejectedValue(new Error("Falha de conexão"));

      // Quando / Então:
      await expect(listarMedicoes(req, res as unknown as Response)).rejects.toThrow("Falha de conexão");
    });

    it("deve enviar cabeçalhos do CSV com Cache-Control no-store e encerrar a resposta quando o formato é csv", async () => {
      // Dado:
      const req = {
        query: { inicio: "2026-11-06", fim: "2026-11-06", formato: "csv" },
        usuario: { id: "gestor-1", papel: "GESTOR_PUBLICO", municipio: "São José dos Campos" },
      } as unknown as Request;
      const res = respostaFalsa();
      jest.mocked(municipioDoPedido).mockResolvedValue("São José dos Campos");
      jest.mocked(escreverCsv).mockResolvedValue(undefined);

      // Quando:
      await listarMedicoes(req, res as unknown as Response);

      // Então:
      expect(res.set).toHaveBeenCalledWith("Cache-Control", "no-store");
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.set).toHaveBeenCalledWith({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition":
          'attachment; filename="pulso-urbano_medicoes_sao-jose-dos-campos_2026-11-06_2026-11-06.csv"',
      });
      expect(escreverCsv).toHaveBeenCalledTimes(1);
      expect(res.end).toHaveBeenCalledTimes(1);
      expect(res.destroy).not.toHaveBeenCalled();
    });

    it("deve registrar o erro no log e encerrar a conexão quando a geração do CSV falha depois de começar", async () => {
      // Dado:
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

      // Quando:
      await listarMedicoes(req, res as unknown as Response);

      // Então:
      expect(res.set).toHaveBeenCalledWith("Cache-Control", "no-store");
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
});
