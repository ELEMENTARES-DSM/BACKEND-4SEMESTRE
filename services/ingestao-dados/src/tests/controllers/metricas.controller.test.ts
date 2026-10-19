process.env.JWT_SECRET = "segredo-teste-supertest-jwt";

import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import request from "supertest";
import jwt from "jsonwebtoken";

import app from "../../app";
import { contarPendentes } from "../../repositories/staging.repository";
import { rejectionMetricsService } from "../../services/rejection-metrics.service";
import { duplicateMetricsService } from "../../services/duplicate-metrics.service";
import { receivedMetricsService } from "../../services/received-metrics.service";
import {
  PAYLOAD_MALFORMADO,
  TIMESTAMP_INVALIDO,
} from "../../validations/motivos-rejeicao";

jest.mock("../../repositories/staging.repository", () => ({
  contarPendentes: jest.fn(),
}));

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

  beforeEach(() => {
    jest.mocked(contarPendentes).mockResolvedValue(0);
    rejectionMetricsService.reset();
    duplicateMetricsService.reset();
    receivedMetricsService.reset();
  });

  it("deve retornar 200 e leiturasRejeitadas como {} quando não há rejeições registradas", async () => {
    const token = criarToken("ADMINISTRADOR");

    const resposta = await request(app)
      .get("/ingestao/metricas")
      .set("Authorization", `Bearer ${token}`);

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({
      leiturasRecebidas: 0,
      leiturasRejeitadas: {},
      duplicadasIgnoradas: 0,
      mensagensPendentes: 0,
    });
  });

  it("deve retornar leiturasRecebidas com o total de mensagens entregues", async () => {
    receivedMetricsService.incrementar();
    receivedMetricsService.incrementar();
    receivedMetricsService.incrementar();

    const resposta = await request(app)
      .get("/ingestao/metricas")
      .set("Authorization", `Bearer ${criarToken("ADMINISTRADOR")}`);

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({
      leiturasRecebidas: 3,
      leiturasRejeitadas: {},
      duplicadasIgnoradas: 0,
    });
  });

  it("deve manter recebidas, rejeitadas e duplicadas cada uma no seu campo", async () => {
    // Rejeitadas e duplicadas também foram recebidas: os contadores são independentes.
    receivedMetricsService.incrementar();
    receivedMetricsService.incrementar();
    rejectionMetricsService.incrementarRejeicao(PAYLOAD_MALFORMADO);
    duplicateMetricsService.incrementar();

    const resposta = await request(app)
      .get("/ingestao/metricas")
      .set("Authorization", `Bearer ${criarToken("ADMINISTRADOR")}`);

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({
      leiturasRecebidas: 2,
      leiturasRejeitadas: { [PAYLOAD_MALFORMADO]: 1 },
      duplicadasIgnoradas: 1,
    });
  });

  it("deve retornar 200 com formato exato e valores corretos quando houver rejeições registradas", async () => {
    rejectionMetricsService.incrementarRejeicao(PAYLOAD_MALFORMADO);
    rejectionMetricsService.incrementarRejeicao(PAYLOAD_MALFORMADO);
    rejectionMetricsService.incrementarRejeicao(TIMESTAMP_INVALIDO);

    const token = criarToken("ADMINISTRADOR");

    const resposta = await request(app)
      .get("/ingestao/metricas")
      .set("Authorization", `Bearer ${token}`);

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({
      leiturasRecebidas: 0,
      leiturasRejeitadas: {
        [PAYLOAD_MALFORMADO]: 2,
        [TIMESTAMP_INVALIDO]: 1,
      },
      duplicadasIgnoradas: 0,
      mensagensPendentes: 0,
    });
  });

  it("deve retornar duplicadasIgnoradas 0 quando não há duplicatas registradas", async () => {
    const resposta = await request(app)
      .get("/ingestao/metricas")
      .set("Authorization", `Bearer ${criarToken("ADMINISTRADOR")}`);

    expect(resposta.status).toBe(200);
    expect(resposta.body.duplicadasIgnoradas).toBe(0);
  });

  it("deve retornar duplicadasIgnoradas 2 e leiturasRejeitadas {} após 2 duplicatas", async () => {
    duplicateMetricsService.incrementar();
    duplicateMetricsService.incrementar();

    const resposta = await request(app)
      .get("/ingestao/metricas")
      .set("Authorization", `Bearer ${criarToken("ADMINISTRADOR")}`);

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({
      leiturasRecebidas: 0,
      leiturasRejeitadas: {},
      duplicadasIgnoradas: 2,
      mensagensPendentes: 0,
    });
  });

  it("deve manter rejeições e duplicatas cada uma no seu campo", async () => {
    rejectionMetricsService.incrementarRejeicao(PAYLOAD_MALFORMADO);
    duplicateMetricsService.incrementar();
    rejectionMetricsService.incrementarRejeicao(TIMESTAMP_INVALIDO);
    duplicateMetricsService.incrementar();
    duplicateMetricsService.incrementar();

    const resposta = await request(app)
      .get("/ingestao/metricas")
      .set("Authorization", `Bearer ${criarToken("ADMINISTRADOR")}`);

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({
      leiturasRecebidas: 0,
      leiturasRejeitadas: {
        [PAYLOAD_MALFORMADO]: 1,
        [TIMESTAMP_INVALIDO]: 1,
      },
      duplicadasIgnoradas: 3,
      mensagensPendentes: 0,
    });
  });

  it("deve zerar duplicadasIgnoradas e leiturasRecebidas ao reiniciar o serviço", async () => {
    duplicateMetricsService.incrementar();
    duplicateMetricsService.incrementar();
    receivedMetricsService.incrementar();

    // Recarregar os módulos simula um novo início do processo.
    await jest.isolateModulesAsync(async () => {
      const { default: appReiniciado } = await import("../../app");

      const resposta = await request(appReiniciado)
        .get("/ingestao/metricas")
        .set("Authorization", `Bearer ${criarToken("ADMINISTRADOR")}`);

      expect(resposta.status).toBe(200);
      expect(resposta.body).toEqual({
        leiturasRecebidas: 0,
        leiturasRejeitadas: {},
        duplicadasIgnoradas: 0,
        mensagensPendentes: 0,
      });
    });

    // O singleton da instância anterior não foi afetado: foi mesmo outra instância.
    expect(duplicateMetricsService.obterTotal()).toBe(2);
    expect(receivedMetricsService.obterTotal()).toBe(1);
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
