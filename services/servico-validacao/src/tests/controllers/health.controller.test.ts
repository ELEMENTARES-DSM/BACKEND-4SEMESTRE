import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { Request, Response } from "express";
import { obterSaude } from "../../controllers/health.controller";
import { verificarConexaoBanco } from "../../config/db";
import { obterEstadoSaudeConsumidor } from "../../events/consumers/rabbitmq-telemetria.consumer";

jest.mock("../../config/db", () => ({
  verificarConexaoBanco: jest.fn(),
}));

jest.mock("../../events/consumers/rabbitmq-telemetria.consumer", () => ({
  obterEstadoSaudeConsumidor: jest.fn(),
}));

describe("health.controller", () => {
  const criarRes = () => {
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    return res as unknown as Response & {
      status: jest.Mock;
      json: jest.Mock;
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("retorna 200 e status ok quando postgres, rabbitmq e fila estão disponíveis", async () => {
    jest.mocked(verificarConexaoBanco).mockResolvedValue(true);
    jest.mocked(obterEstadoSaudeConsumidor).mockReturnValue({
      rabbitmq: "conectado",
      fila: "disponivel",
    });

    const res = criarRes();
    await obterSaude({} as Request, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      status: "ok",
      conexoes: {
        postgres: "conectado",
        rabbitmq: "conectado",
      },
      fila: "disponivel",
    });
  });

  it("retorna 503 quando a fila validacao.telemetria não existe/está indisponível", async () => {
    jest.mocked(verificarConexaoBanco).mockResolvedValue(true);
    jest.mocked(obterEstadoSaudeConsumidor).mockReturnValue({
      rabbitmq: "conectado",
      fila: "indisponivel",
    });

    const res = criarRes();
    await obterSaude({} as Request, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      status: "indisponivel",
      conexoes: {
        postgres: "conectado",
        rabbitmq: "conectado",
      },
      fila: "indisponivel",
    });
  });

  it("retorna 503 quando o RabbitMQ está desconectado", async () => {
    jest.mocked(verificarConexaoBanco).mockResolvedValue(true);
    jest.mocked(obterEstadoSaudeConsumidor).mockReturnValue({
      rabbitmq: "desconectado",
      fila: "indisponivel",
    });

    const res = criarRes();
    await obterSaude({} as Request, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      status: "indisponivel",
      conexoes: {
        postgres: "conectado",
        rabbitmq: "desconectado",
      },
      fila: "indisponivel",
    });
  });

  it("retorna 503 quando o PostgreSQL está desconectado", async () => {
    jest.mocked(verificarConexaoBanco).mockResolvedValue(false);
    jest.mocked(obterEstadoSaudeConsumidor).mockReturnValue({
      rabbitmq: "conectado",
      fila: "disponivel",
    });

    const res = criarRes();
    await obterSaude({} as Request, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      status: "indisponivel",
      conexoes: {
        postgres: "desconectado",
        rabbitmq: "conectado",
      },
      fila: "disponivel",
    });
  });
});
