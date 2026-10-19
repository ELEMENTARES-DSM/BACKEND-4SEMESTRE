process.env.JWT_SECRET = "segredo-teste-metricas-jwt";

import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { AddressInfo } from "node:net";
import { Express } from "express";
import jwt from "jsonwebtoken";

import app from "../../app";
import { sensorInativoMetricsService } from "../../services/sensor-inativo-metrics.service";

// Sem supertest: sobe o app numa porta livre, faz o GET e fecha o servidor.
async function getMetricas(
  aplicacao: Express,
  token?: string,
): Promise<{ status: number; body: unknown }> {
  const servidor = aplicacao.listen(0);
  try {
    await new Promise<void>((resolve) => servidor.once("listening", () => resolve()));
    const { port } = servidor.address() as AddressInfo;
    const resposta = await fetch(`http://127.0.0.1:${port}/validacao/metricas`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return { status: resposta.status, body: await resposta.json() };
  } finally {
    await new Promise<void>((resolve, reject) =>
      servidor.close((erro) => (erro ? reject(erro) : resolve())),
    );
  }
}

describe("GET /validacao/metricas", () => {
  const JWT_SECRET = process.env.JWT_SECRET as string;

  const criarToken = (papel = "ADMINISTRADOR") =>
    jwt.sign({ id: "user-123", papel, municipio: null }, JWT_SECRET, {
      algorithm: "HS256",
    });

  beforeEach(() => {
    sensorInativoMetricsService.reset();
  });

  it("deve retornar 401 quando o token não for informado", async () => {
    const resposta = await getMetricas(app);

    expect(resposta.status).toBe(401);
    expect(resposta.body).toEqual({
      erro: "Autenticação necessária. Token não informado ou formato inválido.",
    });
  });

  it("deve retornar 403 para o perfil GESTOR_PUBLICO", async () => {
    const resposta = await getMetricas(app, criarToken("GESTOR_PUBLICO"));

    expect(resposta.status).toBe(403);
    expect(resposta.body).toEqual({
      erro: "Acesso negado. Perfil insuficiente para esta ação.",
    });
  });

  it("deve retornar 200 com 0 para ADMINISTRADOR quando não há registros", async () => {
    const resposta = await getMetricas(app, criarToken());

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({ leiturasIgnoradasSensorInativo: 0 });
  });

  it("deve retornar 3 depois de 3 registros", async () => {
    sensorInativoMetricsService.incrementar();
    sensorInativoMetricsService.incrementar();
    sensorInativoMetricsService.incrementar();

    const resposta = await getMetricas(app, criarToken());

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({ leiturasIgnoradasSensorInativo: 3 });
  });

  it("deve zerar ao reiniciar o serviço", async () => {
    sensorInativoMetricsService.incrementar();
    sensorInativoMetricsService.incrementar();
    sensorInativoMetricsService.incrementar();

    // Recarregar os módulos simula um novo início do processo.
    await jest.isolateModulesAsync(async () => {
      const { default: appReiniciado } = await import("../../app");

      const resposta = await getMetricas(appReiniciado, criarToken());

      expect(resposta.status).toBe(200);
      expect(resposta.body).toEqual({ leiturasIgnoradasSensorInativo: 0 });
    });

    // O singleton da instância anterior não foi afetado: foi mesmo outra instância.
    expect(sensorInativoMetricsService.obterTotal()).toBe(3);
  });
});
