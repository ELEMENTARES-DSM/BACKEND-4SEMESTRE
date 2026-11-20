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

describe("GET /analise/estacoes/:id/ultimas-leituras (Integração)", () => {
  beforeAll(() => {
    process.env.JWT_SECRET = JWT_SECRET;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("deve retornar 200 OK com as últimas leituras válidas da estação", async () => {
    const tokenAdmin = gerarToken({
      id: "admin-1",
      papel: PERFIS.ADMINISTRADOR,
      municipio: null,
    });

    // Ordem: 1. Busca estação | 2. Busca medições
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
            valor_calibrado: 18.2,
            valor: 20.0,
            unidade: "µg/m³",
            timestamp_leitura: new Date(),
          },
        ],
      });

    const response = await request(app)
      .get("/analise/estacoes/EST-01/ultimas-leituras")
      .set("Authorization", `Bearer ${tokenAdmin}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("estacaoId", "EST-01");
    expect(response.body.leituras).toHaveLength(1);
    expect(response.body.leituras[0]).toMatchObject({
      grandeza: "PM25",
      valorCalibrado: 18.2,
      unidade: "µg/m³",
    });
  });

  it("deve retornar 404 quando Gestor tenta acessar estação de outro município", async () => {
    const tokenGestorJacarei = gerarToken({
      id: "gestor-2",
      papel: PERFIS.GESTOR_PUBLICO,
      municipio: "Jacareí",
    });

    // Busca estação (pertencente a São José dos Campos)
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "e0000000-0000-4000-8000-000000000001",
          codigo: "EST-01",
          municipio: "São José dos Campos",
        },
      ],
    });

    const response = await request(app)
      .get("/analise/estacoes/EST-01/ultimas-leituras")
      .set("Authorization", `Bearer ${tokenGestorJacarei}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      statusCode: 404,
      message: "Estação não encontrada.",
    });
  });

  it("deve retornar 404 quando a estação não for encontrada", async () => {
    const tokenAdmin = gerarToken({
      id: "admin-1",
      papel: PERFIS.ADMINISTRADOR,
      municipio: null,
    });

    // O serviço retorna vazio (estação não encontrada)
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const response = await request(app)
      .get("/analise/estacoes/inexistente/ultimas-leituras")
      .set("Authorization", `Bearer ${tokenAdmin}`);

    expect(response.status).toBe(404);
  });
});
