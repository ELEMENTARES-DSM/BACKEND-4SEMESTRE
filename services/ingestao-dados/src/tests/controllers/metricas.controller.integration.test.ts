process.env.JWT_SECRET = "segredo-teste-supertest-jwt";

import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import request from "supertest";
import jwt from "jsonwebtoken";

import app from "../../app";
import { lerMetricas, MetricasIngestao } from "../../repositories/staging-valkey.repository";
import { PAYLOAD_MALFORMADO, TIMESTAMP_INVALIDO } from "../../validations/motivos-rejeicao";

jest.mock("../../repositories/staging-valkey.repository", () => ({
  lerMetricas: jest.fn(),
}));

// Integração sem containers: rota do Express + middleware JWT/papel +
// controller; só o Valkey (lerMetricas) é falso. A leitura real do Valkey está
// em staging-valkey.integration.test.ts e o unitário em metricas.controller.test.ts.
describe("GET /ingestao/metricas", () => {
  const JWT_SECRET = process.env.JWT_SECRET as string;

  const criarToken = (
    papel = "ADMINISTRADOR",
    id = "user-123",
    municipio = "São José dos Campos",
  ) => {
    return jwt.sign({ id, papel, municipio }, JWT_SECRET, {
      algorithm: "HS256",
    });
  };

  const zeradas: MetricasIngestao = {
    leiturasRecebidas: 0,
    leiturasRejeitadas: {},
    duplicadasIgnoradas: 0,
    mensagensPendentes: 0,
    mensagensEncaminhadas: 0,
    pendenteMaisAntigaEm: null,
  };

  beforeEach(() => {
    jest.mocked(lerMetricas).mockResolvedValue(zeradas);
  });

  describe("US-21 · contadores lidos do Valkey", () => {
    it("deve retornar 200 com todos os campos zerados, leiturasRejeitadas {} e pendenteMaisAntigaEm null quando nada chegou", async () => {
      // Dado (Arrange)
      // Quando (Act)
      const resposta = await request(app)
        .get("/ingestao/metricas")
        .set("Authorization", `Bearer ${criarToken()}`);

      // Então (Assert)
      expect(resposta.status).toBe(200);
      expect(resposta.body).toEqual(zeradas);
    });

    it("deve retornar cada contador no seu campo e as recusadas por motivo quando há leituras de todos os tipos", async () => {
      // Dado (Arrange)
      const metricas: MetricasIngestao = {
        leiturasRecebidas: 10,
        leiturasRejeitadas: { [PAYLOAD_MALFORMADO]: 2, [TIMESTAMP_INVALIDO]: 1 },
        duplicadasIgnoradas: 1,
        mensagensPendentes: 2,
        mensagensEncaminhadas: 4,
        pendenteMaisAntigaEm: "2026-11-16T10:00:00.000Z",
      };
      jest.mocked(lerMetricas).mockResolvedValue(metricas);

      // Quando (Act)
      const resposta = await request(app)
        .get("/ingestao/metricas")
        .set("Authorization", `Bearer ${criarToken()}`);

      // Então (Assert)
      expect(resposta.status).toBe(200);
      expect(resposta.body).toEqual(metricas);
    });

    it("deve retornar 500 quando o Valkey não responde", async () => {
      // Dado (Arrange)
      jest.mocked(lerMetricas).mockRejectedValue(new Error("The client is offline"));

      // Quando (Act)
      const resposta = await request(app)
        .get("/ingestao/metricas")
        .set("Authorization", `Bearer ${criarToken()}`);

      // Então (Assert)
      expect(resposta.status).toBe(500);
      expect(resposta.body).toEqual({ erro: "Não foi possível consultar métricas de ingestão." });
    });
  });

  it("deve retornar 401 quando o token não for informado", async () => {
    const resposta = await request(app).get("/ingestao/metricas");

    expect(resposta.status).toBe(401);
    expect(resposta.body).toEqual({
      erro: "Autenticação necessária. Token não informado ou formato inválido.",
    });
  });

  it("deve retornar 401 quando o cabeçalho Authorization não começar com 'Bearer '", async () => {
    const resposta = await request(app)
      .get("/ingestao/metricas")
      .set("Authorization", "Basic tokeninvalido");

    expect(resposta.status).toBe(401);
    expect(resposta.body).toEqual({
      erro: "Autenticação necessária. Token não informado ou formato inválido.",
    });
  });

  it("deve retornar 401 quando o token for inválido", async () => {
    const resposta = await request(app)
      .get("/ingestao/metricas")
      .set("Authorization", "Bearer token-completamente-invalido");

    expect(resposta.status).toBe(401);
    expect(resposta.body).toEqual({
      erro: "Token inválido ou expirado.",
    });
  });

  it("deve retornar 401 quando o token for assinado com segredo diferente", async () => {
    const tokenInvalido = jwt.sign(
      { id: "123", papel: "ADMINISTRADOR", municipio: null },
      "outro-segredo",
      { algorithm: "HS256" },
    );

    const resposta = await request(app)
      .get("/ingestao/metricas")
      .set("Authorization", `Bearer ${tokenInvalido}`);

    expect(resposta.status).toBe(401);
    expect(resposta.body).toEqual({
      erro: "Token inválido ou expirado.",
    });
  });

  it("deve retornar 403 quando o papel for diferente de ADMINISTRADOR (ex: GESTOR_PUBLICO)", async () => {
    const tokenGestor = criarToken("GESTOR_PUBLICO");

    const resposta = await request(app)
      .get("/ingestao/metricas")
      .set("Authorization", `Bearer ${tokenGestor}`);

    expect(resposta.status).toBe(403);
    expect(resposta.body).toEqual({
      erro: "Acesso negado. Perfil insuficiente para esta ação.",
    });
  });

  it("deve retornar 403 quando o papel for USUARIO", async () => {
    const tokenUsuario = criarToken("USUARIO");

    const resposta = await request(app)
      .get("/ingestao/metricas")
      .set("Authorization", `Bearer ${tokenUsuario}`);

    expect(resposta.status).toBe(403);
    expect(resposta.body).toEqual({
      erro: "Acesso negado. Perfil insuficiente para esta ação.",
    });
  });
});
