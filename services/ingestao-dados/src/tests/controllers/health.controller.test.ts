import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { Request, Response } from "express";
import { obterSaude } from "../../controllers/health.controller";
import { mqttStatusService } from "../../services/mqtt-status.service";
import { rabbitMqConectado } from "../../services/staging-publisher.service";

// Unitário de obterSaude: o estado do RabbitMQ é mockado; o do MQTT é o
// contador em memória (interno, sem rede).
jest.mock("../../services/staging-publisher.service", () => ({ rabbitMqConectado: jest.fn() }));

function respostaFalsa() {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}

describe("obterSaude", () => {
  beforeEach(() => {
    mqttStatusService.marcarDesconectado();
    jest.mocked(rabbitMqConectado).mockReturnValue(true);
  });

  it("deve responder 200 com as duas conexões ativas quando MQTT e RabbitMQ estão conectados", () => {
    // Dado (Arrange)
    mqttStatusService.marcarConectado();
    const res = respostaFalsa();

    // Quando (Act)
    obterSaude({} as Request, res as unknown as Response);

    // Então (Assert)
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ status: "ok", conexoes: { mqtt: "conectado", rabbitmq: "conectado" } });
  });

  it("deve responder 503 quando o MQTT está desconectado", () => {
    // Dado (Arrange)
    const res = respostaFalsa();

    // Quando (Act)
    obterSaude({} as Request, res as unknown as Response);

    // Então (Assert)
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      status: "indisponivel",
      conexoes: { mqtt: "desconectado", rabbitmq: "conectado" },
    });
  });

  it("deve responder 503 quando o RabbitMQ está desconectado", () => {
    // Dado (Arrange)
    mqttStatusService.marcarConectado();
    jest.mocked(rabbitMqConectado).mockReturnValue(false);
    const res = respostaFalsa();

    // Quando (Act)
    obterSaude({} as Request, res as unknown as Response);

    // Então (Assert)
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      status: "indisponivel",
      conexoes: { mqtt: "conectado", rabbitmq: "desconectado" },
    });
  });
});
