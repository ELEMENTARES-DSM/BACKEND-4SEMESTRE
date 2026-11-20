import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import request from "supertest";
import app from "../../app";
import { pool } from "../../config/db";

jest.mock("../../config/db", () => ({
  pool: {
    query: jest.fn(),
  },
}));

const mockQuery = pool.query as unknown as jest.Mock;

describe("Testes de Integração - Rotas Públicas de Análise (Task 35.09)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("Dado que um usuário anônimo faz uma requisição GET válida sem token, quando consulta as séries públicas de um município, então deve retornar 200 OK", async () => {
    // 1. Mock da primeira query: validação da estação pertencente ao município
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "e0000000-0000-4000-8000-000000000001",
          codigo: "EST-01",
          municipio: "sjc",
        },
      ],
    } as never);

    // 2. Mock da segunda query: serviço de séries busca novamente a estação pelo ID
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "e0000000-0000-4000-8000-000000000001",
          codigo: "EST-01",
          municipio: "sjc",
        },
      ],
    } as never);

    // 3. Mock da terceira query: serviço busca as medidas históricas agregadas
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          bucket_brt: "2026-06-06T10:00:00",
          media_valor: "25.40",
        },
      ],
    } as never);

    const response = await request(app).get(
      "/public/analise/publico/sjc/estacoes/EST-01/series?grandeza=PM25&periodo=24h",
    );

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("estacaoId");
    expect(response.body).toHaveProperty("dados");
    expect(Array.isArray(response.body.dados)).toBe(true);
  });

  it("Dado que um usuário anônimo solicita um período maior que 7 dias (ex: 30d) na rota pública, quando a requisição é feita, então deve retornar 400 Bad Request", async () => {
    // Mock da estação válida
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "e0000000-0000-4000-8000-000000000001",
          codigo: "EST-01",
          municipio: "sjc",
        },
      ],
    } as never);

    const response = await request(app).get(
      "/public/analise/publico/sjc/estacoes/EST-01/series?grandeza=PM25&periodo=30d",
    );

    expect(response.status).toBe(400);
    expect(response.body.message).toContain("7 dias");
  });

  it("Dado que a estação não pertence ao município informado na URL pública, quando a requisição é feita, então deve retornar 404 Not Found", async () => {
    // Mock retornando vazio (estação não encontrada no município)
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);

    const response = await request(app).get(
      "/public/analise/publico/jacarei/estacoes/EST-01/series?grandeza=PM25&periodo=24h",
    );

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      statusCode: 404,
      message: "Estação não encontrada.",
    });
  });
});
