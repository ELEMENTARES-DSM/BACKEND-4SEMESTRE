import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { pool } from "../../config/db";
import { obterSeriesHistoricas } from "../../services/series.service";
import { UltimasLeiturasService } from "../../services/ultimas-leituras.service";
import {
  ErroHttpPublicAnalise,
  PublicAnaliseService,
} from "../../services/public-analise.service";

jest.mock("../../config/db", () => ({
  pool: {
    query: jest.fn(),
  },
}));

jest.mock("../../services/series.service", () => ({
  obterSeriesHistoricas: jest.fn(),
}));

const mockQuery = pool.query as unknown as jest.Mock;
const mockObterSeries = obterSeriesHistoricas as unknown as jest.Mock;

describe("public-analise.service (US-35)", () => {
  let mockObterUltimasLeituras: jest.Mock;
  let service: PublicAnaliseService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockObterUltimasLeituras = jest.fn();
    const ultimasLeiturasServiceMock = {
      obterUltimasLeituras: mockObterUltimasLeituras,
    } as unknown as UltimasLeiturasService;
    service = new PublicAnaliseService(ultimasLeiturasServiceMock);
  });

  describe("obterSeriesPublicas", () => {
    it("deve reutilizar obterSeriesHistoricas com municipio e apenasAtivas quando os parâmetros são válidos", async () => {
      // Dado: resposta simulada do serviço de séries históricas
      const respostaEsperada = {
        estacaoId: "EST-01",
        grandeza: "PM25",
        periodo: "7d" as const,
        dados: [{ timestamp: "2026-06-06T10:00:00-03:00", valor: 19.5 }],
      };
      mockObterSeries.mockResolvedValueOnce(respostaEsperada as never);

      // Quando: consulta as séries públicas da estação no município
      const resultado = await service.obterSeriesPublicas({
        municipio: " São José dos Campos ",
        codigo: " EST-01 ",
        grandeza: "PM25",
        periodo: "7d",
      });

      // Então: delega ao serviço protegido exigindo município e estação ativa
      expect(mockObterSeries).toHaveBeenCalledWith({
        estacaoId: "EST-01",
        grandeza: "PM25",
        periodo: "7d",
        municipio: "São José dos Campos",
        apenasAtivas: true,
      });
      expect(resultado).toEqual(respostaEsperada);
    });

    it("deve lançar erro 404 quando município ou código da estação está vazio", async () => {
      // Dado: município contendo apenas espaços em branco
      // Quando / Então: rejeita com ErroHttpPublicAnalise 404 sem chamar o serviço de séries
      await expect(
        service.obterSeriesPublicas({
          municipio: "   ",
          codigo: "EST-01",
          grandeza: "PM25",
          periodo: "24h",
        }),
      ).rejects.toEqual(new ErroHttpPublicAnalise(404, "Estação não encontrada."));
      expect(mockObterSeries).not.toHaveBeenCalled();
    });
  });

  describe("obterUltimasLeiturasPublicas", () => {
    it("deve reutilizar UltimasLeiturasService com municipio e apenasAtivas quando os parâmetros são válidos", async () => {
      // Dado: resposta simulada do serviço de últimas leituras com grandeza dinâmica
      const respostaEsperada = {
        estacaoId: "EST-01",
        leituras: [
          {
            grandeza: "Temperatura",
            valorCalibrado: 26.3,
            unidade: "°C",
            tempoRelativo: "há 2 min",
          },
        ],
      };
      mockObterUltimasLeituras.mockResolvedValueOnce(respostaEsperada as never);

      // Quando: consulta as últimas leituras públicas da estação no município
      const resultado = await service.obterUltimasLeiturasPublicas({
        municipio: "São José dos Campos",
        codigo: "EST-01",
      });

      // Então: delega ao serviço protegido exigindo município e estação ativa
      expect(mockObterUltimasLeituras).toHaveBeenCalledWith({
        estacaoId: "EST-01",
        municipio: "São José dos Campos",
        apenasAtivas: true,
      });
      expect(resultado).toEqual(respostaEsperada);
    });

    it("deve lançar erro 404 quando o código da estação está vazio", async () => {
      // Dado: código de estação vazio
      // Quando / Então: rejeita com 404 sem chamar UltimasLeiturasService
      await expect(
        service.obterUltimasLeiturasPublicas({
          municipio: "São José dos Campos",
          codigo: " ",
        }),
      ).rejects.toEqual(new ErroHttpPublicAnalise(404, "Estação não encontrada."));
      expect(mockObterUltimasLeituras).not.toHaveBeenCalled();
    });
  });

  describe("obterIqarPublico", () => {
    it("deve retornar o IQAr do município quando existe estação ativa cadastrada", async () => {
      // Dado: estação ativa encontrada no município solicitado
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "e0000000-0000-4000-8000-000000000001",
            codigo: "EST-01",
            municipio: "São José dos Campos",
          },
        ],
      } as never);

      // Quando: consulta o IQAr público do município sem especificar estacaoId
      const resultado = await service.obterIqarPublico({
        municipio: "São José dos Campos",
      });

      // Então: filtra por município e status 'Ativa' e devolve o resultado do município
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain("status = 'Ativa'");
      expect(sql).toContain("UPPER(municipio) = UPPER($1)");
      expect(resultado).toEqual({
        indice: 45,
        classificacao: "Boa",
        cor: "#00E400",
        municipio: "São José dos Campos",
      });
    });

    it("deve validar município e status ativo quando estacaoId é informado", async () => {
      // Dado: estação ativa encontrada pertencendo ao município informado
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "e0000000-0000-4000-8000-000000000001",
            codigo: "EST-01",
            municipio: "Jacareí",
          },
        ],
      } as never);

      // Quando: consulta o IQAr público passando estacaoId específico
      const resultado = await service.obterIqarPublico({
        municipio: "Jacareí",
        estacaoId: "EST-01",
      });

      // Então: a query exige correspondência de estação, município e status ativo
      const [sql, valores] = mockQuery.mock.calls[0] as [string, string[]];
      expect(sql).toContain("status = 'Ativa'");
      expect(sql).toContain("UPPER(municipio) = UPPER($2)");
      expect(valores).toEqual(["EST-01", "Jacareí"]);
      expect(resultado.municipio).toBe("Jacareí");
    });

    it("deve lançar erro 404 quando não há estação ativa no município ou a estação pertence a outro município", async () => {
      // Dado: consulta ao banco não retorna nenhuma estação ativa no município
      mockQuery.mockResolvedValueOnce({ rows: [] } as never);

      // Quando / Então: rejeita com ErroHttpPublicAnalise 404
      await expect(
        service.obterIqarPublico({
          municipio: "Jacareí",
          estacaoId: "EST-DE-SJC",
        }),
      ).rejects.toEqual(new ErroHttpPublicAnalise(404, "Estação não encontrada."));
    });

    it("deve lançar erro 404 quando o município informado está vazio", async () => {
      // Dado: município composto apenas de espaços
      // Quando / Então: rejeita com 404 sem consultar o banco
      await expect(
        service.obterIqarPublico({ municipio: "   " }),
      ).rejects.toEqual(new ErroHttpPublicAnalise(404, "Estação não encontrada."));
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });
});
