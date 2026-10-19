import { describe, it, expect, beforeEach } from "@jest/globals";
import request from "supertest";

import app from "../../app";
import { mqttStatusService } from "../../services/mqtt-status.service";

describe("GET /ingestao/health", () => {
  beforeEach(() => {
    mqttStatusService.marcarDesconectado();
  });

  it("deve retornar 200 com o MQTT conectado, sem exigir token", async () => {
    mqttStatusService.marcarConectado();

    const resposta = await request(app).get("/ingestao/health");

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({
      status: "ok",
      conexoes: { mqtt: "conectado" },
    });
  });

  it("deve retornar 503 com o MQTT desconectado (broker indisponível na inicialização)", async () => {
    const resposta = await request(app).get("/ingestao/health");

    expect(resposta.status).toBe(503);
    expect(resposta.body).toEqual({
      status: "indisponivel",
      conexoes: { mqtt: "desconectado" },
    });
  });

  it("deve acompanhar a queda e a volta do broker", async () => {
    mqttStatusService.marcarConectado();
    mqttStatusService.marcarDesconectado();

    const durante = await request(app).get("/ingestao/health");
    expect(durante.status).toBe(503);
    expect(durante.body.conexoes.mqtt).toBe("desconectado");

    mqttStatusService.marcarConectado();

    const depois = await request(app).get("/ingestao/health");
    expect(depois.status).toBe(200);
    expect(depois.body.conexoes.mqtt).toBe("conectado");
  });
});
