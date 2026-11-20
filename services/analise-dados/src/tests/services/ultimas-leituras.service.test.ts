import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { UltimasLeiturasService } from "../../services/ultimas-leituras.service";
import { pool } from "../../config/db";
import { PERFIS } from "../../middlewares/auth.middleware";

jest.mock("../../config/db", () => ({
  pool: {
    query: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockQuery = pool.query as any;

describe("UltimasLeiturasService (US-19 / US-17)", () => {
  let service: UltimasLeiturasService;

  beforeEach(() => {
    service = new UltimasLeiturasService();
    jest.clearAllMocks();
  });

  it("deve retornar as últimas leituras válidas por grandeza com tempo relativo e valor calibrado", async () => {
    // Dado: estação existente e retorno de medições válidas
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: "e0000000-0000-4000-8000-000000000001",
            codigo: "EST-01",
            municipio: "São José dos Campos",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            grandeza: "PM25",
            valor_calibrado: 45.2,
            valor: 50.0,
            unidade: "µg/m³",
            timestamp_leitura: new Date(Date.now() - 5 * 60 * 1000), // 5 min atrás
          },
        ],
      });

    // Quando: o serviço é executado
    const resultado = await service.obterUltimasLeituras({
      estacaoId: "EST-01",
    });

    // Então: retorna a leitura formatada corretamente
    expect(resultado.estacaoId).toBe("EST-01");
    expect(resultado.leituras).toHaveLength(1);
    expect(resultado.leituras[0]).toMatchObject({
      grandeza: "PM25",
      valorCalibrado: 45.2,
      unidade: "µg/m³",
      tempoRelativo: "há 5 min",
    });
  });

  it("deve retornar 404 quando Gestor tenta acessar estação de outro município (Isolamento)", async () => {
    // Dado: estação de São José dos Campos e gestor de Jacareí
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "e0000000-0000-4000-8000-000000000001",
          codigo: "EST-01",
          municipio: "São José dos Campos",
        },
      ],
    });

    const usuarioGestor = {
      id: "gestor-1",
      papel: PERFIS.GESTOR_PUBLICO,
      municipio: "Jacareí",
    };

    // Quando / Então: deve lançar ErroHttpUltimasLeituras com status 404
    await expect(
      service.obterUltimasLeituras({
        estacaoId: "EST-01",
        usuario: usuarioGestor,
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      message: "Estação não encontrada.",
    });
  });

  it("deve lançar erro 404 quando a estação não for encontrada", async () => {
    // Dado: estação inexistente
    mockQuery.mockResolvedValueOnce({ rows: [] });

    // Quando / Então: deve rejeitar com 404
    await expect(
      service.obterUltimasLeituras({ estacaoId: "inexistente" }),
    ).rejects.toMatchObject({
      statusCode: 404,
      message: "Estação não encontrada.",
    });
  });
});
