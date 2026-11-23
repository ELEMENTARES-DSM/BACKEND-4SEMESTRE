import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import {
  ErroHttpIqar,
  IqarService,
  SEM_DADOS_SUFICIENTES,
} from "../../services/iqar.service";
import { pool } from "../../config/db";
import { PERFIS } from "../../middlewares/auth.middleware";

jest.mock("../../config/db", () => ({
  pool: {
    query: jest.fn(),
  },
}));

const mockQuery = pool.query as unknown as jest.Mock;

const AGORA_MS = Date.parse("2026-11-20T18:00:00Z");
const AGORA_UNIX = Math.floor(AGORA_MS / 1000);
const ESTACAO_SJC = {
  id: "e0000000-0000-4000-8000-000000000001",
  codigo: "EST-01",
  municipio: "São José dos Campos",
};

describe("iqar.service (US-35)", () => {
  let service: IqarService;

  beforeEach(() => {
    service = new IqarService(() => AGORA_MS);
    jest.clearAllMocks();
  });

  describe("consulta da estação e isolamento por município", () => {
    it("deve lançar 404 quando a estação não existe no banco", async () => {
      // Dado
      mockQuery.mockResolvedValueOnce({ rows: [] } as never);

      // Quando / Então
      await expect(
        service.calcularIqarPorEstacao({ estacaoId: "estacao-inexistente" }),
      ).rejects.toMatchObject({
        statusCode: 404,
        message: "Estação não encontrada.",
      });
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it("deve lançar 404 quando o gestor público solicita estação de outro município", async () => {
      // Dado
      mockQuery.mockResolvedValueOnce({
        rows: [{ ...ESTACAO_SJC, municipio: "Jacareí" }],
      } as never);
      const gestor = {
        id: "gestor-1",
        papel: PERFIS.GESTOR_PUBLICO,
        municipio: "São José dos Campos",
      };

      // Quando / Então
      await expect(
        service.calcularIqarPorEstacao({ estacaoId: "EST-01", usuario: gestor }),
      ).rejects.toEqual(new ErroHttpIqar(404, "Estação não encontrada."));
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it("deve lançar 404 quando o gestor público não tem município no token", async () => {
      // Dado
      mockQuery.mockResolvedValueOnce({ rows: [ESTACAO_SJC] } as never);
      const gestorSemMunicipio = {
        id: "gestor-2",
        papel: PERFIS.GESTOR_PUBLICO,
        municipio: null,
      };

      // Quando / Então
      await expect(
        service.calcularIqarPorEstacao({
          estacaoId: "EST-01",
          usuario: gestorSemMunicipio,
        }),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it("deve permitir o cálculo quando o gestor público acessa estação do próprio município", async () => {
      // Dado
      mockQuery
        .mockResolvedValueOnce({ rows: [ESTACAO_SJC] } as never)
        .mockResolvedValueOnce({
          rows: [
            { valor: "10", valida: true, unixtime: AGORA_UNIX - 24 * 3600 },
            { valor: "10", valida: true, unixtime: AGORA_UNIX },
          ],
        } as never);
      const gestor = {
        id: "gestor-1",
        papel: PERFIS.GESTOR_PUBLICO,
        municipio: "são josé dos campos",
      };

      // Quando
      const resultado = await service.calcularIqarPorEstacao({
        estacaoId: "EST-01",
        usuario: gestor,
      });

      // Então
      expect(resultado).toMatchObject({
        estacaoId: "EST-01",
        indice: 10,
        classificacao: "Boa",
        status: "Boa",
        rotuloFaixa: "Boa",
        cor: "#00E400",
        municipio: "São José dos Campos",
      });
    });
  });

  describe("janela estrita de 24h e descarte de medidas inválidas", () => {
    it("deve consultar apenas leituras válidas de PM2.5 na janela exata de 24 horas", async () => {
      // Dado
      mockQuery
        .mockResolvedValueOnce({ rows: [ESTACAO_SJC] } as never)
        .mockResolvedValueOnce({ rows: [] } as never);

      // Quando
      await service.calcularIqarPorEstacao({ estacaoId: "EST-01" });

      // Então
      const [sql, params] = mockQuery.mock.calls[1] as [string, unknown[]];
      expect(sql).toContain("m.valida = true");
      expect(sql).toContain("UPPER(REPLACE(s.tipo, '.', '')) = 'PM25'");
      expect(sql).toContain("m.unixtime >= $2");
      expect(sql).toContain("m.unixtime <= $3");
      expect(params).toEqual([
        ESTACAO_SJC.id,
        AGORA_UNIX - 86400,
        AGORA_UNIX,
      ]);
    });

    it("deve retornar 'Sem dados suficientes' quando não há leituras no período", async () => {
      // Dado
      mockQuery
        .mockResolvedValueOnce({ rows: [ESTACAO_SJC] } as never)
        .mockResolvedValueOnce({ rows: [] } as never);

      // Quando
      const resultado = await service.calcularIqarPorEstacao({
        estacaoId: "EST-01",
      });

      // Então
      expect(resultado).toEqual({
        estacaoId: "EST-01",
        indice: SEM_DADOS_SUFICIENTES,
        status: SEM_DADOS_SUFICIENTES,
        rotuloFaixa: SEM_DADOS_SUFICIENTES,
        mensagem: "Não há dados suficientes para calcular o IQAr.",
        municipio: "São José dos Campos",
      });
    });

    it("deve retornar 'Sem dados suficientes' quando todas as leituras no período são inválidas", async () => {
      // Dado
      mockQuery
        .mockResolvedValueOnce({ rows: [ESTACAO_SJC] } as never)
        .mockResolvedValueOnce({
          rows: [
            { valor: "15", valida: false, unixtime: AGORA_UNIX - 24 * 3600 },
            { valor: "20", valida: false, unixtime: AGORA_UNIX },
          ],
        } as never);

      // Quando
      const resultado = await service.calcularIqarPorEstacao({
        estacaoId: "EST-01",
      });

      // Então
      expect(resultado.indice).toBe(SEM_DADOS_SUFICIENTES);
      expect(resultado.status).toBe(SEM_DADOS_SUFICIENTES);
      expect(resultado.rotuloFaixa).toBe(SEM_DADOS_SUFICIENTES);
    });

    it("deve retornar 'Sem dados suficientes' quando o histórico de 24h depende de leitura inválida", async () => {
      // Dado: 1 leitura inválida há 24h e apenas 1 leitura válida há 1h
      mockQuery
        .mockResolvedValueOnce({ rows: [ESTACAO_SJC] } as never)
        .mockResolvedValueOnce({
          rows: [
            { valor: "999", valida: false, unixtime: AGORA_UNIX - 24 * 3600 },
            { valor: "10", valida: true, unixtime: AGORA_UNIX - 3600 },
          ],
        } as never);

      // Quando
      const resultado = await service.calcularIqarPorEstacao({
        estacaoId: "EST-01",
      });

      // Então
      expect(resultado.indice).toBe(SEM_DADOS_SUFICIENTES);
      expect(resultado.status).toBe(SEM_DADOS_SUFICIENTES);
    });

    it("deve retornar 'Sem dados suficientes' quando o histórico válido tem 22h59min (logo abaixo da borda)", async () => {
      // Dado
      const segundosAbaixo = 23 * 3600 - 60;
      mockQuery
        .mockResolvedValueOnce({ rows: [ESTACAO_SJC] } as never)
        .mockResolvedValueOnce({
          rows: [
            { valor: "12", valida: true, unixtime: AGORA_UNIX - segundosAbaixo },
            { valor: "12", valida: true, unixtime: AGORA_UNIX },
          ],
        } as never);

      // Quando
      const resultado = await service.calcularIqarPorEstacao({
        estacaoId: "EST-01",
      });

      // Então
      expect(resultado.indice).toBe(SEM_DADOS_SUFICIENTES);
    });

    it("deve calcular o IQAr quando o histórico válido atinge exatamente 23h (série horária de 24 leituras)", async () => {
      // Dado
      const segundosNaBorda = 23 * 3600;
      mockQuery
        .mockResolvedValueOnce({ rows: [ESTACAO_SJC] } as never)
        .mockResolvedValueOnce({
          rows: [
            { valor: "12", valida: true, unixtime: AGORA_UNIX - segundosNaBorda },
            { valor: "12", valida: true, unixtime: AGORA_UNIX },
          ],
        } as never);

      // Quando
      const resultado = await service.calcularIqarPorEstacao({
        estacaoId: "EST-01",
      });

      // Então
      expect(resultado.indice).toBe(12);
      expect(resultado.classificacao).toBe("Boa");
    });

    it("deve descartar medidas inválidas ao calcular a média de PM2.5", async () => {
      // Dado: duas leituras válidas (10 e 14 -> média 12) e uma inválida (500)
      mockQuery
        .mockResolvedValueOnce({ rows: [ESTACAO_SJC] } as never)
        .mockResolvedValueOnce({
          rows: [
            { valor: "10", valida: true, unixtime: AGORA_UNIX - 24 * 3600 },
            { valor: "500", valida: false, unixtime: AGORA_UNIX - 12 * 3600 },
            { valor: "14", valida: true, unixtime: AGORA_UNIX },
          ],
        } as never);

      // Quando
      const resultado = await service.calcularIqarPorEstacao({
        estacaoId: "EST-01",
      });

      // Então
      expect(resultado.indice).toBe(12);
      expect(resultado.classificacao).toBe("Boa");
    });
  });

  describe("faixas oficiais do IQAr (CONAMA 506/2024 / MMA / CETESB) com bordas dos dois lados", () => {
    it.each([
      [0, 0, "Boa", "#00E400"],
      [15, 15, "Boa", "#00E400"],
      [15.1, 15, "Moderada", "#FFFF00"],
      [50, 50, "Moderada", "#FFFF00"],
      [50.1, 50, "Ruim", "#FF7E00"],
      [75, 75, "Ruim", "#FF7E00"],
      [75.1, 75, "Muito Ruim", "#FF0000"],
      [125, 125, "Muito Ruim", "#FF0000"],
      [125.1, 125, "Péssima", "#8F3F97"],
      [180, 180, "Péssima", "#8F3F97"],
    ])(
      "deve classificar média %s µg/m³ como %s (%s) quando está na faixa oficial",
      async (media, indiceEsperado, faixaEsperada, corEsperada) => {
        // Dado
        mockQuery
          .mockResolvedValueOnce({ rows: [ESTACAO_SJC] } as never)
          .mockResolvedValueOnce({
            rows: [
              { valor: String(media), valida: true, unixtime: AGORA_UNIX - 24 * 3600 },
              { valor: String(media), valida: true, unixtime: AGORA_UNIX },
            ],
          } as never);

        // Quando
        const resultado = await service.calcularIqarPorEstacao({
          estacaoId: "EST-01",
        });

        // Então
        expect(resultado).toMatchObject({
          estacaoId: "EST-01",
          indice: indiceEsperado,
          classificacao: faixaEsperada,
          status: faixaEsperada,
          rotuloFaixa: faixaEsperada,
          cor: corEsperada,
          municipio: "São José dos Campos",
        });
      },
    );
  });
});
