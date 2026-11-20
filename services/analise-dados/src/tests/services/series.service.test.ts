import { pool } from "../../config/db";
import { PERFIS } from "../../middlewares/auth.middleware";
import {
  ErroHttpSeries,
  formatarTimestampBrasilia,
  obterSeriesHistoricas,
} from "../../services/series.service";

jest.mock("../../config/db", () => ({
  pool: {
    query: jest.fn(),
  },
}));

const mockQuery = pool.query as jest.Mock;

describe("series.service (US-35)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("formatarTimestampBrasilia", () => {
    it("deve converter para o dia anterior em Brasília quando o horário UTC é 02:30", () => {
      // Dado: um instante UTC logo após a meia-noite (02:30 UTC = 23:30 do dia anterior em UTC-3)
      const dataUtc = new Date("2026-10-25T02:30:00.000Z");

      // Quando: formata o timestamp para o fuso de Brasília
      const resultado = formatarTimestampBrasilia(dataUtc);

      // Então: retorna o dia anterior com offset -03:00
      expect(resultado).toBe("2026-10-24T23:30:00-03:00");
    });

    it("deve manter o mesmo dia e adicionar offset -03:00 quando já recebe string truncada em BRT", () => {
      // Dado: uma string de bucket já truncada no horário local de Brasília
      const bucketLocal = "2026-06-06 10:00:00";

      // Quando: formata o timestamp
      const resultado = formatarTimestampBrasilia(bucketLocal);

      // Então: retorna no formato ISO-8601 com -03:00
      expect(resultado).toBe("2026-06-06T10:00:00-03:00");
    });
  });

  describe("obterSeriesHistoricas", () => {
    it("deve retornar série agregada em intervalos de 5 minutos ignorando medidas inválidas quando período é 24h", async () => {
      // Dado: uma estação existente no município do gestor e leituras agregadas em 5 minutos
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: "e0000000-0000-4000-8000-000000000001",
              codigo: "EST-HIST-01",
              municipio: "São José dos Campos",
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { bucket_brt: "2026-06-06T10:00:00", media_valor: "25.40" },
            { bucket_brt: "2026-06-06T10:05:00", media_valor: "26.10" },
          ],
        });

      // Quando: consulta a série de 24h para PM2.5
      const resultado = await obterSeriesHistoricas({
        estacaoId: "EST-HIST-01",
        grandeza: "PM2.5",
        periodo: "24h",
        usuario: {
          id: "gestor-1",
          papel: PERFIS.GESTOR_PUBLICO,
          municipio: "São José dos Campos",
        },
      });

      // Então: retorna os pontos de 5 em 5 minutos e garante filtro de valida = true na query
      const sqlMedidas = mockQuery.mock.calls[1][0] as string;
      expect(sqlMedidas).toContain("m.valida = true");
      expect(sqlMedidas).toContain("INTERVAL '5 minutes'");
      expect(resultado).toEqual({
        estacaoId: "EST-HIST-01",
        grandeza: "PM2.5",
        periodo: "24h",
        dados: [
          { timestamp: "2026-06-06T10:00:00-03:00", valor: 25.4 },
          { timestamp: "2026-06-06T10:05:00-03:00", valor: 26.1 },
        ],
      });
    });

    it("deve calcular a média por hora quando o período solicitado é 7d", async () => {
      // Dado: uma estação válida e leituras agregadas por hora
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: "e0000000-0000-4000-8000-000000000001",
              codigo: "EST-HIST-01",
              municipio: "São José dos Campos",
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ bucket_brt: "2026-06-06T11:00:00", media_valor: "31.25" }],
        });

      // Quando: consulta a série de 7d
      const resultado = await obterSeriesHistoricas({
        estacaoId: "EST-HIST-01",
        grandeza: "PM25",
        periodo: "7d",
        usuario: {
          id: "admin-1",
          papel: PERFIS.ADMINISTRADOR,
          municipio: null,
        },
      });

      // Então: agrupa por hora (date_trunc('hour')) e retorna a média horária
      const sqlMedidas = mockQuery.mock.calls[1][0] as string;
      expect(sqlMedidas).toContain("date_trunc('hour'");
      expect(resultado.dados).toEqual([
        { timestamp: "2026-06-06T11:00:00-03:00", valor: 31.25 },
      ]);
    });

    it("deve calcular a média por dia quando o período solicitado é 30d", async () => {
      // Dado: uma estação válida e leituras agregadas por dia
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: "e0000000-0000-4000-8000-000000000001",
              codigo: "EST-HIST-01",
              municipio: "São José dos Campos",
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ bucket_brt: "2026-06-06T00:00:00", media_valor: "28.90" }],
        });

      // Quando: consulta a série de 30d
      const resultado = await obterSeriesHistoricas({
        estacaoId: "EST-HIST-01",
        grandeza: "PM10",
        periodo: "30d",
        usuario: {
          id: "admin-1",
          papel: PERFIS.ADMINISTRADOR,
          municipio: null,
        },
      });

      // Então: agrupa por dia (date_trunc('day')) e retorna a média diária
      const sqlMedidas = mockQuery.mock.calls[1][0] as string;
      expect(sqlMedidas).toContain("date_trunc('day'");
      expect(resultado.dados).toEqual([
        { timestamp: "2026-06-06T00:00:00-03:00", valor: 28.9 },
      ]);
    });

    it("deve lançar erro 404 quando a estação não existe no banco", async () => {
      // Dado: nenhuma estação encontrada para o identificador informado
      mockQuery.mockResolvedValueOnce({ rows: [] });

      // Quando / Então: consulta a série e recebe 404 Not Found
      await expect(
        obterSeriesHistoricas({
          estacaoId: "EST-INEXISTENTE",
          grandeza: "PM2.5",
          periodo: "24h",
          usuario: {
            id: "admin-1",
            papel: PERFIS.ADMINISTRADOR,
            municipio: null,
          },
        }),
      ).rejects.toEqual(new ErroHttpSeries(404, "Estação não encontrada."));
    });

    it("deve lançar erro 404 quando Gestor Público consulta estação de outro município", async () => {
      // Dado: uma estação pertencente a São José dos Campos e um gestor de Taubaté
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "e0000000-0000-4000-8000-000000000001",
            codigo: "EST-HIST-01",
            municipio: "São José dos Campos",
          },
        ],
      });

      // Quando / Então: gestor de outro município recebe 404 (idêntico a estação inexistente)
      await expect(
        obterSeriesHistoricas({
          estacaoId: "EST-HIST-01",
          grandeza: "PM2.5",
          periodo: "7d",
          usuario: {
            id: "gestor-taubate",
            papel: PERFIS.GESTOR_PUBLICO,
            municipio: "Taubaté",
          },
        }),
      ).rejects.toEqual(new ErroHttpSeries(404, "Estação não encontrada."));
    });

    it("deve permitir acesso global quando usuário é Administrador", async () => {
      // Dado: uma estação em São José dos Campos e um Administrador com município distinto
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: "e0000000-0000-4000-8000-000000000001",
              codigo: "EST-HIST-01",
              municipio: "São José dos Campos",
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] });

      // Quando: Administrador consulta a série da estação
      const resultado = await obterSeriesHistoricas({
        estacaoId: "EST-HIST-01",
        grandeza: "PM2.5",
        periodo: "7d",
        usuario: {
          id: "admin-1",
          papel: PERFIS.ADMINISTRADOR,
          municipio: "Jacareí",
        },
      });

      // Então: consulta é autorizada normalmente
      expect(resultado.estacaoId).toBe("EST-HIST-01");
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });
  });
});
