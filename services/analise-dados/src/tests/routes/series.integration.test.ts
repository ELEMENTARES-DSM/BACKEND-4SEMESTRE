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

const mockQuery = pool.query as jest.Mock;
const JWT_SECRET = process.env.JWT_SECRET || "test-secret";

function gerarToken(payload: {
  id: string;
  papel: string;
  municipio: string | null;
}) {
  return jwt.sign(payload, JWT_SECRET, { algorithm: "HS256" });
}

describe("analise.routes - GET /analise/estacoes/:id/series (US-35)", () => {
  beforeAll(() => {
    process.env.JWT_SECRET = JWT_SECRET;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("deve retornar 200 OK para requisição anônima nos períodos 24h e 7d", async () => {
    // Dado: dados horários no banco para a estação consultada sem header Authorization
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
        rows: [{ bucket_brt: "2026-06-06T10:00:00", media_valor: "22.50" }],
      })
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
        rows: [{ bucket_brt: "2026-06-06T11:00:00", media_valor: "24.00" }],
      });

    // Quando: faz requisições anônimas para 24h e 7d
    const res24h = await request(app)
      .get("/analise/estacoes/EST-HIST-01/series")
      .query({ grandeza: "PM2.5", periodo: "24h" });

    const res7d = await request(app)
      .get("/analise/estacoes/EST-HIST-01/series")
      .query({ grandeza: "PM2.5", periodo: "7d" });

    // Então: ambas respondem 200 OK no formato do contrato OpenAPI
    expect(res24h.status).toBe(200);
    expect(res24h.body).toEqual({
      estacaoId: "EST-HIST-01",
      grandeza: "PM2.5",
      periodo: "24h",
      dados: [{ timestamp: "2026-06-06T10:00:00-03:00", valor: 22.5 }],
    });

    expect(res7d.status).toBe(200);
    expect(res7d.body).toEqual({
      estacaoId: "EST-HIST-01",
      grandeza: "PM2.5",
      periodo: "7d",
      dados: [{ timestamp: "2026-06-06T11:00:00-03:00", valor: 24.0 }],
    });
  });

  it("deve retornar 400 Bad Request para requisição anônima no período 30d", async () => {
    // Dado: uma requisição sem header Authorization solicitando 30d (acima do limite de 7d para anônimo)
    // Quando: chama /analise/estacoes/:id/series com periodo=30d
    const response = await request(app)
      .get("/analise/estacoes/EST-HIST-01/series")
      .query({ grandeza: "PM2.5", periodo: "30d" });

    // Então: responde 400 Bad Request
    expect(response.status).toBe(400);
  });

  it("deve retornar 401 Unauthorized quando requisição possui token inválido", async () => {
    // Dado: uma requisição com Bearer token inválido
    // Quando: chama /analise/estacoes/:id/series
    const response = await request(app)
      .get("/analise/estacoes/EST-HIST-01/series")
      .query({ grandeza: "PM2.5", periodo: "24h" })
      .set("Authorization", "Bearer token-invalido");

    // Então: responde 401 Unauthorized
    expect(response.status).toBe(401);
  });

  it("deve retornar 200 OK com série horária quando Gestor consulta estação do próprio município em 7d", async () => {
    // Dado: token de Gestor de São José dos Campos e dados horários no banco
    const tokenGestor = gerarToken({
      id: "gestor-sjc",
      papel: PERFIS.GESTOR_PUBLICO,
      municipio: "São José dos Campos",
    });

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
          { bucket_brt: "2026-06-06T10:00:00", media_valor: "22.50" },
          { bucket_brt: "2026-06-06T11:00:00", media_valor: "24.00" },
        ],
      });

    // Quando: faz GET para /analise/estacoes/EST-HIST-01/series?grandeza=PM2.5&periodo=7d
    const response = await request(app)
      .get("/analise/estacoes/EST-HIST-01/series")
      .query({ grandeza: "PM2.5", periodo: "7d" })
      .set("Authorization", `Bearer ${tokenGestor}`);

    // Então: responde 200 OK no formato do contrato OpenAPI
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      estacaoId: "EST-HIST-01",
      grandeza: "PM2.5",
      periodo: "7d",
      dados: [
        { timestamp: "2026-06-06T10:00:00-03:00", valor: 22.5 },
        { timestamp: "2026-06-06T11:00:00-03:00", valor: 24.0 },
      ],
    });
  });

  it("deve retornar 404 Not Found quando Gestor tenta acessar estação de outro município", async () => {
    // Dado: token de Gestor de Jacareí tentando acessar estação de São José dos Campos
    const tokenGestorOutroMunicipio = gerarToken({
      id: "gestor-jacarei",
      papel: PERFIS.GESTOR_PUBLICO,
      municipio: "Jacareí",
    });

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "e0000000-0000-4000-8000-000000000001",
          codigo: "EST-HIST-01",
          municipio: "São José dos Campos",
        },
      ],
    });

    // Quando: consulta a série da estação de outro município
    const response = await request(app)
      .get("/analise/estacoes/EST-HIST-01/series")
      .query({ grandeza: "PM2.5", periodo: "24h" })
      .set("Authorization", `Bearer ${tokenGestorOutroMunicipio}`);

    // Então: responde 404 Not Found sem vazar existência da estação
    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      statusCode: 404,
      message: "Estação não encontrada.",
    });
  });

  it("deve retornar 200 OK quando Administrador consulta estação de qualquer município em 30d", async () => {
    // Dado: token de Administrador e estação em São José dos Campos
    const tokenAdmin = gerarToken({
      id: "admin-1",
      papel: PERFIS.ADMINISTRADOR,
      municipio: null,
    });

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
        rows: [{ bucket_brt: "2026-06-06T00:00:00", media_valor: "30.15" }],
      });

    // Quando: Administrador solicita série de 30d
    const response = await request(app)
      .get("/analise/estacoes/EST-HIST-01/series")
      .query({ grandeza: "PM2.5", periodo: "30d" })
      .set("Authorization", `Bearer ${tokenAdmin}`);

    // Então: responde 200 OK com dados agregados por dia
    expect(response.status).toBe(200);
    expect(response.body.periodo).toBe("30d");
    expect(response.body.dados).toHaveLength(1);
  });

  it("deve retornar 400 Bad Request quando período ou grandeza são inválidos", async () => {
    // Dado: token de Administrador válido
    const tokenAdmin = gerarToken({
      id: "admin-1",
      papel: PERFIS.ADMINISTRADOR,
      municipio: null,
    });

    // Quando: envia período fora do enum (90d) ou omite grandeza
    const resPeriodoInvalido = await request(app)
      .get("/analise/estacoes/EST-HIST-01/series")
      .query({ grandeza: "PM2.5", periodo: "90d" })
      .set("Authorization", `Bearer ${tokenAdmin}`);

    const resSemGrandeza = await request(app)
      .get("/analise/estacoes/EST-HIST-01/series")
      .query({ periodo: "24h" })
      .set("Authorization", `Bearer ${tokenAdmin}`);

    // Então: ambas as requisições falham com 400 Bad Request
    expect(resPeriodoInvalido.status).toBe(400);
    expect(resSemGrandeza.status).toBe(400);
  });
});
