process.env.JWT_SECRET = "segredo-teste-metricas-validacao";

import { AddressInfo } from "node:net";
import { Server } from "node:http";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import jwt from "jsonwebtoken";
import app from "../../app";
import { metricasValidacaoService } from "../../services/metricas-validacao.service";

// Sobe o app numa porta livre e consulta com o fetch do Node, sem dependência extra.
describe("GET /validacao/metricas", () => {
  let servidor: Server;
  let baseUrl: string;

  const criarToken = (papel = "ADMINISTRADOR", segredo = process.env.JWT_SECRET as string) =>
    jwt.sign({ id: "user-123", papel, municipio: null }, segredo, { algorithm: "HS256" });

  const consultar = (cabecalhos: Record<string, string> = {}) =>
    fetch(`${baseUrl}/validacao/metricas`, { headers: cabecalhos });

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      servidor = app.listen(0, "127.0.0.1", () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => servidor.close(() => resolve()));
  });

  beforeEach(() => {
    metricasValidacaoService.reset();
  });

  it("responde 200 com o contador em 0 logo após o início", async () => {
    const resposta = await consultar({ Authorization: `Bearer ${criarToken()}` });

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({
      leiturasIgnoradasSensorInativo: 0,
      medidasInvalidasGravadas: 0,
    });
  });

  it("mostra as leituras ignoradas por sensor inativo desde que o serviço subiu", async () => {
    metricasValidacaoService.incrementarIgnoradasSensorInativo(3);

    const resposta = await consultar({ Authorization: `Bearer ${criarToken()}` });

    expect(await resposta.json()).toEqual({
      leiturasIgnoradasSensorInativo: 3,
      medidasInvalidasGravadas: 0,
    });
  });

  it("mostra as medidas inválidas gravadas desde que o serviço subiu (US-19)", async () => {
    metricasValidacaoService.incrementarMedidasInvalidasGravadas();
    metricasValidacaoService.incrementarMedidasInvalidasGravadas();

    const resposta = await consultar({ Authorization: `Bearer ${criarToken()}` });

    expect(await resposta.json()).toEqual({
      leiturasIgnoradasSensorInativo: 0,
      medidasInvalidasGravadas: 2,
    });
  });

  it("responde 401 sem token", async () => {
    const resposta = await consultar();

    expect(resposta.status).toBe(401);
    expect(await resposta.json()).toEqual({
      erro: "Autenticação necessária. Token não informado ou formato inválido.",
    });
  });

  it("responde 401 com token assinado por outro segredo", async () => {
    const resposta = await consultar({
      Authorization: `Bearer ${criarToken("ADMINISTRADOR", "outro-segredo")}`,
    });

    expect(resposta.status).toBe(401);
    expect(await resposta.json()).toEqual({ erro: "Token inválido ou expirado." });
  });

  it("responde 403 para perfil diferente de ADMINISTRADOR", async () => {
    const resposta = await consultar({ Authorization: `Bearer ${criarToken("GESTOR_PUBLICO")}` });

    expect(resposta.status).toBe(403);
    expect(await resposta.json()).toEqual({
      erro: "Acesso negado. Perfil insuficiente para esta ação.",
    });
  });
});
