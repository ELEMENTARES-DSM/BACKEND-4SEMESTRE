import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { IqarService, ErroHttpIqar } from "../../services/iqar.service";
import { pool } from "../../config/db";

jest.mock("../../config/db", () => ({
  pool: {
    query: jest.fn(),
  },
}));

const mockQuery = pool.query as unknown as jest.Mock;

describe("IqarService (Unitários)", () => {
  let iqarService: IqarService;

  beforeEach(() => {
    iqarService = new IqarService();
    jest.clearAllMocks();
  });

  describe("Cenário de Estação Não Encontrada", () => {
    it("Dado que a estação não existe no banco, quando solicitado o cálculo do IQAr, então deve retornar erro HTTP 404", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] } as never);

      await expect(
        iqarService.calcularIqarPorEstacao({
          estacaoId: "estacao-inexistente",
        }),
      ).rejects.toThrow(new ErroHttpIqar(404, "Estação não encontrada."));
    });
  });

  describe("Cenário de Segurança por Perfil (Multi-tenancy)", () => {
    it("Dado que um gestor público tenta acessar uma estação de outro município, quando solicitado o cálculo do IQAr, então deve retornar erro HTTP 404", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: "uuid-1", codigo: "EST-01", municipio: "Jacareí" }],
      } as never);

      const gestor = {
        id: "gestor-1", // Adicionada a propriedade 'id' exigida pelo AuthPayload
        papel: "GESTOR_PUBLICO",
        municipio: "São José dos Campos",
      };

      await expect(
        iqarService.calcularIqarPorEstacao({
          estacaoId: "EST-01",
          usuario: gestor,
        }),
      ).rejects.toThrow(new ErroHttpIqar(404, "Estação não encontrada."));
    });
  });

  describe("Cenário de Dados Insuficientes", () => {
    it("Dado que a estação não possui leituras no período, quando solicitado o cálculo do IQAr, então deve retornar 'Sem dados suficientes'", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "uuid-1",
            codigo: "EST-01",
            municipio: "São José dos Campos",
          },
        ],
      } as never);
      mockQuery.mockResolvedValueOnce({ rows: [] } as never);

      const resultado = await iqarService.calcularIqarPorEstacao({
        estacaoId: "EST-01",
      });

      expect(resultado.indice).toBe("Sem dados suficientes");
    });

    it("Dado que a estação possui histórico inferior a 24 horas, quando solicitado o cálculo do IQAr, então deve retornar 'Sem dados suficientes'", async () => {
      const agoraUnixtime = Math.floor(Date.now() / 1000);
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "uuid-1",
            codigo: "EST-01",
            municipio: "São José dos Campos",
          },
        ],
      } as never);
      mockQuery.mockResolvedValueOnce({
        rows: [
          { valor: 15, valida: true, unixtime: agoraUnixtime - 3600 },
          { valor: 20, valida: true, unixtime: agoraUnixtime - 7200 },
        ],
      } as never);

      const resultado = await iqarService.calcularIqarPorEstacao({
        estacaoId: "EST-01",
      });

      expect(resultado.indice).toBe("Sem dados suficientes");
    });
  });

  describe("Cenário de Classificação nas 5 Faixas Oficiais e Descarte de Inválidas", () => {
    it("Dado que existem leituras válidas e inválidas cobrindo 24h, quando calculado o IQAr, então deve descartar as inválidas e retornar a faixa 'Boa'", async () => {
      const agoraUnixtime = Math.floor(Date.now() / 1000);
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "uuid-1",
            codigo: "EST-01",
            municipio: "São José dos Campos",
          },
        ],
      } as never);
      mockQuery.mockResolvedValueOnce({
        rows: [
          { valor: 10, valida: true, unixtime: agoraUnixtime - 100000 },
          { valor: 50, valida: false, unixtime: agoraUnixtime - 50000 },
          { valor: 10, valida: true, unixtime: agoraUnixtime - 1000 },
        ],
      } as never);

      const resultado = await iqarService.calcularIqarPorEstacao({
        estacaoId: "EST-01",
      });

      expect(resultado.indice).toBe(10);
      expect(resultado.classificacao).toBe("Boa");
      expect(resultado.cor).toBe("#00E400");
    });

    it("Dado que a média de PM2.5 está na faixa 'Moderada', quando calculado o IQAr, então deve retornar a classificação correta", async () => {
      const agoraUnixtime = Math.floor(Date.now() / 1000);
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "uuid-1",
            codigo: "EST-01",
            municipio: "São José dos Campos",
          },
        ],
      } as never);
      mockQuery.mockResolvedValueOnce({
        rows: [
          { valor: 20, valida: true, unixtime: agoraUnixtime - 100000 },
          { valor: 30, valida: true, unixtime: agoraUnixtime - 1000 },
        ],
      } as never);

      const resultado = await iqarService.calcularIqarPorEstacao({
        estacaoId: "EST-01",
      });

      expect(resultado.indice).toBe(25);
      expect(resultado.classificacao).toBe("Moderada");
      expect(resultado.cor).toBe("#FFFF00");
    });

    it("Dado que a média de PM2.5 está na faixa 'Ruim', quando calculado o IQAr, então deve retornar a classificação correta", async () => {
      const agoraUnixtime = Math.floor(Date.now() / 1000);
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "uuid-1",
            codigo: "EST-01",
            municipio: "São José dos Campos",
          },
        ],
      } as never);
      mockQuery.mockResolvedValueOnce({
        rows: [
          { valor: 40, valida: true, unixtime: agoraUnixtime - 100000 },
          { valor: 50, valida: true, unixtime: agoraUnixtime - 1000 },
        ],
      } as never);

      const resultado = await iqarService.calcularIqarPorEstacao({
        estacaoId: "EST-01",
      });

      expect(resultado.indice).toBe(45);
      expect(resultado.classificacao).toBe("Ruim");
      expect(resultado.cor).toBe("#FF7E00");
    });

    it("Dado que a média de PM2.5 está na faixa 'Muito Ruim', quando calculado o IQAr, então deve retornar a classificação correta", async () => {
      const agoraUnixtime = Math.floor(Date.now() / 1000);
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "uuid-1",
            codigo: "EST-01",
            municipio: "São José dos Campos",
          },
        ],
      } as never);
      mockQuery.mockResolvedValueOnce({
        rows: [
          { valor: 60, valida: true, unixtime: agoraUnixtime - 100000 },
          { valor: 100, valida: true, unixtime: agoraUnixtime - 1000 },
        ],
      } as never);

      const resultado = await iqarService.calcularIqarPorEstacao({
        estacaoId: "EST-01",
      });

      expect(resultado.indice).toBe(80);
      expect(resultado.classificacao).toBe("Muito Ruim");
      expect(resultado.cor).toBe("#FF0000");
    });

    it("Dado que a média de PM2.5 está na faixa 'Péssima', quando calculado o IQAr, então deve retornar a classificação correta", async () => {
      const agoraUnixtime = Math.floor(Date.now() / 1000);
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "uuid-1",
            codigo: "EST-01",
            municipio: "São José dos Campos",
          },
        ],
      } as never);
      mockQuery.mockResolvedValueOnce({
        rows: [
          { valor: 160, valida: true, unixtime: agoraUnixtime - 100000 },
          { valor: 200, valida: true, unixtime: agoraUnixtime - 1000 },
        ],
      } as never);

      const resultado = await iqarService.calcularIqarPorEstacao({
        estacaoId: "EST-01",
      });

      expect(resultado.indice).toBe(180);
      expect(resultado.classificacao).toBe("Péssima");
      expect(resultado.cor).toBe("#8F3F97");
    });
  });
});
