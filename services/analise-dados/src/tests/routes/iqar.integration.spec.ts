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

describe("GET /analise/estacoes/:id/iqar (Integração)", () => {
  beforeAll(() => {
    process.env.JWT_SECRET = JWT_SECRET;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("Dado que um administrador solicita o IQAr com dados válidos, quando a requisição é feita, então deve retornar 200 OK com o cálculo correto", async () => {
    const tokenAdmin = gerarToken({
      id: "admin-1",
      papel: PERFIS.ADMINISTRADOR,
      municipio: null,
    });

    const agoraUnixtime = Math.floor(Date.now() / 1000);
    const duasDiasAtras = agoraUnixtime - 48 * 3600;
    const umaHoraAtras = agoraUnixtime - 3600;

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "e0000000-0000-4000-8000-000000000001",
          codigo: "EST-01",
          municipio: "São José dos Campos",
        },
      ],
    } as never);

    mockQuery.mockResolvedValueOnce({
      rows: [
        { valor: 10, valida: true, unixtime: duasDiasAtras },
        { valor: 10, valida: true, unixtime: umaHoraAtras },
      ],
    } as never);

    const response = await request(app)
      .get("/analise/estacoes/EST-01/iqar")
      .set("Authorization", `Bearer ${tokenAdmin}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("estacaoId", "EST-01");
    expect(response.body).toMatchObject({
      indice: 10,
      classificacao: "Boa",
      cor: "#00E400",
      municipio: "São José dos Campos",
    });
  });

  it("Dado que um Gestor tenta acessar uma estação de outro município, quando a requisição é feita, então deve retornar 404", async () => {
    const tokenGestorJacarei = gerarToken({
      id: "gestor-2",
      papel: PERFIS.GESTOR_PUBLICO,
      municipio: "Jacareí",
    });

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "e0000000-0000-4000-8000-000000000001",
          codigo: "EST-01",
          municipio: "São José dos Campos",
        },
      ],
    } as never);

    const response = await request(app)
      .get("/analise/estacoes/EST-01/iqar")
      .set("Authorization", `Bearer ${tokenGestorJacarei}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      statusCode: 404,
      message: "Estação não encontrada.",
    });
  });

  it("Dado que a estação não é encontrada, quando a requisição é feita, então deve retornar 404", async () => {
    const tokenAdmin = gerarToken({
      id: "admin-1",
      papel: PERFIS.ADMINISTRADOR,
      municipio: null,
    });

    mockQuery.mockResolvedValueOnce({ rows: [] } as never);

    const response = await request(app)
      .get("/analise/estacoes/inexistente/iqar")
      .set("Authorization", `Bearer ${tokenAdmin}`);

    expect(response.status).toBe(404);
  });

  it("Dado que a rota de IQAr é chamada sem o ID da estação, quando a requisição é feita, então deve retornar 400", async () => {
    const tokenAdmin = gerarToken({
      id: "admin-1",
      papel: PERFIS.ADMINISTRADOR,
      municipio: null,
    });

    const response = await request(app)
      .get("/analise/iqar")
      .set("Authorization", `Bearer ${tokenAdmin}`);

    expect(response.status).toBe(400);
    expect(response.body.message).toContain("Informe o ID da estação");
  });
});
