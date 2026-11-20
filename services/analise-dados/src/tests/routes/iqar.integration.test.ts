import {
  describe,
  it,
  expect,
  beforeEach,
  beforeAll,
  jest,
} from "@jest/globals";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../../app";
import { pool } from "../../config/db";
import { PERFIS } from "../../middlewares/auth.middleware";

jest.mock("../../config/db", () => ({
  pool: {
    query: jest.fn(),
  },
}));

const mockQuery = pool.query as unknown as jest.Mock;
const JWT_SECRET = process.env.JWT_SECRET || "test-secret";

function gerarToken(payload: {
  id: string;
  papel: string;
  municipio: string | null;
}) {
  return jwt.sign(payload, JWT_SECRET, { algorithm: "HS256" });
}

const ESTACAO_SJC = {
  id: "e0000000-0000-4000-8000-000000000001",
  codigo: "EST-01",
  municipio: "São José dos Campos",
};

describe("iqar.routes (US-35)", () => {
  beforeAll(() => {
    process.env.JWT_SECRET = JWT_SECRET;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("deve retornar 401 quando não envia token de autorização", async () => {
    // Quando
    const response = await request(app).get("/analise/estacoes/EST-01/iqar");

    // Então
    expect(response.status).toBe(401);
  });

  it("deve retornar 401 quando envia token inválido", async () => {
    // Quando
    const response = await request(app)
      .get("/analise/estacoes/EST-01/iqar")
      .set("Authorization", "Bearer token-invalido");

    // Então
    expect(response.status).toBe(401);
  });

  it("deve retornar 200 com o IQAr oficial quando o administrador consulta estação com 24h válidas", async () => {
    // Dado
    const tokenAdmin = gerarToken({
      id: "admin-1",
      papel: PERFIS.ADMINISTRADOR,
      municipio: null,
    });
    const agoraUnixtime = Math.floor(Date.now() / 1000);
    mockQuery
      .mockResolvedValueOnce({ rows: [ESTACAO_SJC] } as never)
      .mockResolvedValueOnce({
        rows: [
          { valor: "15", valida: true, unixtime: agoraUnixtime - 24 * 3600 },
          { valor: "15", valida: true, unixtime: agoraUnixtime - 60 },
        ],
      } as never);

    // Quando
    const response = await request(app)
      .get("/analise/estacoes/EST-01/iqar")
      .set("Authorization", `Bearer ${tokenAdmin}`);

    // Então
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      estacaoId: "EST-01",
      indice: 15,
      classificacao: "Boa",
      status: "Boa",
      rotuloFaixa: "Boa",
      cor: "#00E400",
      mensagem: "Qualidade do ar considerada boa.",
      municipio: "São José dos Campos",
    });
  });

  it("deve retornar 200 quando o gestor público consulta estação do próprio município", async () => {
    // Dado
    const tokenGestorSjc = gerarToken({
      id: "gestor-1",
      papel: PERFIS.GESTOR_PUBLICO,
      municipio: "São José dos Campos",
    });
    const agoraUnixtime = Math.floor(Date.now() / 1000);
    mockQuery
      .mockResolvedValueOnce({ rows: [ESTACAO_SJC] } as never)
      .mockResolvedValueOnce({
        rows: [
          { valor: "30", valida: true, unixtime: agoraUnixtime - 24 * 3600 },
          { valor: "30", valida: true, unixtime: agoraUnixtime - 60 },
        ],
      } as never);

    // Quando
    const response = await request(app)
      .get("/analise/estacoes/EST-01/iqar")
      .set("Authorization", `Bearer ${tokenGestorSjc}`);

    // Então
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      estacaoId: "EST-01",
      indice: 30,
      classificacao: "Moderada",
      cor: "#FFFF00",
      municipio: "São José dos Campos",
    });
  });

  it("deve retornar 200 com 'Sem dados suficientes' quando a estação tem menos de 24h de dados", async () => {
    // Dado
    const tokenAdmin = gerarToken({
      id: "admin-1",
      papel: PERFIS.ADMINISTRADOR,
      municipio: null,
    });
    const agoraUnixtime = Math.floor(Date.now() / 1000);
    mockQuery
      .mockResolvedValueOnce({ rows: [ESTACAO_SJC] } as never)
      .mockResolvedValueOnce({
        rows: [
          { valor: "12", valida: true, unixtime: agoraUnixtime - 10 * 3600 },
          { valor: "14", valida: true, unixtime: agoraUnixtime - 3600 },
        ],
      } as never);

    // Quando
    const response = await request(app)
      .get("/analise/estacoes/EST-01/iqar")
      .set("Authorization", `Bearer ${tokenAdmin}`);

    // Então
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      estacaoId: "EST-01",
      indice: "Sem dados suficientes",
      status: "Sem dados suficientes",
      rotuloFaixa: "Sem dados suficientes",
      municipio: "São José dos Campos",
    });
  });

  it("deve retornar 404 quando o gestor público solicita estação de outro município", async () => {
    // Dado
    const tokenGestorJacarei = gerarToken({
      id: "gestor-2",
      papel: PERFIS.GESTOR_PUBLICO,
      municipio: "Jacareí",
    });
    mockQuery.mockResolvedValueOnce({ rows: [ESTACAO_SJC] } as never);

    // Quando
    const response = await request(app)
      .get("/analise/estacoes/EST-01/iqar")
      .set("Authorization", `Bearer ${tokenGestorJacarei}`);

    // Então
    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      statusCode: 404,
      message: "Estação não encontrada.",
    });
  });

  it("deve retornar 404 quando a estação não existe", async () => {
    // Dado
    const tokenAdmin = gerarToken({
      id: "admin-1",
      papel: PERFIS.ADMINISTRADOR,
      municipio: null,
    });
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);

    // Quando
    const response = await request(app)
      .get("/analise/estacoes/inexistente/iqar")
      .set("Authorization", `Bearer ${tokenAdmin}`);

    // Então
    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      statusCode: 404,
      message: "Estação não encontrada.",
    });
  });

  it("deve retornar 400 quando GET /analise/iqar é chamada sem estacaoId", async () => {
    // Dado
    const tokenAdmin = gerarToken({
      id: "admin-1",
      papel: PERFIS.ADMINISTRADOR,
      municipio: null,
    });

    // Quando
    const response = await request(app)
      .get("/analise/iqar")
      .set("Authorization", `Bearer ${tokenAdmin}`);

    // Então
    expect(response.status).toBe(400);
    expect(response.body.message).toContain("Informe o ID da estação");
  });

  it("deve retornar 200 quando GET /analise/iqar é chamada com ?estacaoId válido", async () => {
    // Dado
    const tokenAdmin = gerarToken({
      id: "admin-1",
      papel: PERFIS.ADMINISTRADOR,
      municipio: null,
    });
    const agoraUnixtime = Math.floor(Date.now() / 1000);
    mockQuery
      .mockResolvedValueOnce({ rows: [ESTACAO_SJC] } as never)
      .mockResolvedValueOnce({
        rows: [
          { valor: "10", valida: true, unixtime: agoraUnixtime - 24 * 3600 },
          { valor: "10", valida: true, unixtime: agoraUnixtime - 60 },
        ],
      } as never);

    // Quando
    const response = await request(app)
      .get("/analise/iqar?estacaoId=EST-01")
      .set("Authorization", `Bearer ${tokenAdmin}`);

    // Então
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      estacaoId: "EST-01",
      indice: 10,
      classificacao: "Boa",
    });
  });
});
