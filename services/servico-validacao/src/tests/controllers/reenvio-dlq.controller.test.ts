process.env.JWT_SECRET = "segredo-teste-reenvio-dlq";

import { AddressInfo } from "node:net";
import { Server } from "node:http";
import { describe, it, expect, jest, beforeAll, afterAll, beforeEach } from "@jest/globals";
import jwt from "jsonwebtoken";
import app from "../../app";
import {
  RabbitMqIndisponivelError,
  reenviarEventosDlq,
} from "../../services/reenvio-dlq.service";
import logger from "../../utils/logger";

jest.mock("../../services/reenvio-dlq.service", () => {
  const real = jest.requireActual<typeof import("../../services/reenvio-dlq.service")>(
    "../../services/reenvio-dlq.service",
  );
  return { ...real, reenviarEventosDlq: jest.fn() };
});

const reenviar = jest.mocked(reenviarEventosDlq);

// TASK 20.02: rota POST /validacao/dlq/reenviar.
describe("POST /validacao/dlq/reenviar", () => {
  let servidor: Server;
  let baseUrl: string;

  const token = (papel = "ADMINISTRADOR", id = "admin-1") =>
    jwt.sign({ id, papel, municipio: null }, process.env.JWT_SECRET as string, { algorithm: "HS256" });

  const chamar = (corpo?: unknown, autorizacao: string | null = `Bearer ${token()}`) =>
    fetch(`${baseUrl}/validacao/dlq/reenviar`, {
      method: "POST",
      headers: {
        ...(autorizacao ? { Authorization: autorizacao } : {}),
        ...(corpo === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });

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
    jest.restoreAllMocks();
    reenviar.mockReset();
    reenviar.mockResolvedValue({ reenviados: 30, restantes: 0 });
    jest.spyOn(logger, "info").mockImplementation(() => undefined);
    jest.spyOn(logger, "error").mockImplementation(() => undefined);
  });

  it("sem quantidade reenvia todos e responde reenviados e restantes", async () => {
    const resposta = await chamar();

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ reenviados: 30, restantes: 0 });
    expect(reenviar).toHaveBeenCalledWith(undefined);
  });

  it("com quantidade 10 pede só 10 ao serviço", async () => {
    reenviar.mockResolvedValue({ reenviados: 10, restantes: 20 });

    const resposta = await chamar({ quantidade: 10 });

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ reenviados: 10, restantes: 20 });
    expect(reenviar).toHaveBeenCalledWith(10);
  });

  it.each([0, -3, "texto", 1.5, null, "10"])(
    "quantidade %p responde 400 \"Quantidade inválida\" e nada é reenviado",
    async (quantidade) => {
      const resposta = await chamar({ quantidade });

      expect(resposta.status).toBe(400);
      expect(await resposta.json()).toEqual({ erro: "Quantidade inválida" });
      expect(reenviar).not.toHaveBeenCalled();
    },
  );

  it("sem login responde 401 e nada é reenviado", async () => {
    const resposta = await chamar({}, null);

    expect(resposta.status).toBe(401);
    expect(reenviar).not.toHaveBeenCalled();
  });

  it("perfil diferente de ADMINISTRADOR responde 403 e nada é reenviado", async () => {
    const resposta = await chamar({}, `Bearer ${token("GESTOR_PUBLICO")}`);

    expect(resposta.status).toBe(403);
    expect(reenviar).not.toHaveBeenCalled();
  });

  it("só um reenvio por vez: o segundo pedido responde 409", async () => {
    let concluir: () => void = () => undefined;
    reenviar.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          concluir = () => resolve({ reenviados: 5, restantes: 0 });
        }),
    );

    const primeiro = chamar();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const segundo = await chamar();

    expect(segundo.status).toBe(409);
    expect(await segundo.json()).toEqual({ erro: "Reenvio já em andamento" });

    concluir();
    expect((await primeiro).status).toBe(200);
    // Terminado o primeiro, um novo reenvio é aceito.
    expect((await chamar()).status).toBe(200);
  });

  it("RabbitMQ indisponível responde 503 e libera novos reenvios", async () => {
    reenviar.mockRejectedValueOnce(new RabbitMqIndisponivelError("connect ECONNREFUSED", 2));

    const resposta = await chamar();

    expect(resposta.status).toBe(503);
    expect(await resposta.json()).toEqual({ erro: "RabbitMQ indisponível" });
    expect(logger.error).toHaveBeenCalledWith(
      "Reenvio da DLQ interrompido: RabbitMQ indisponível",
      expect.objectContaining({ usuario: "admin-1", reenviados: 2 }),
    );
    expect((await chamar()).status).toBe(200);
  });

  it("registra em log o usuário, o horário e a quantidade reenviada", async () => {
    reenviar.mockResolvedValue({ reenviados: 12, restantes: 3 });

    await chamar({ quantidade: 12 }, `Bearer ${token("ADMINISTRADOR", "admin-42")}`);

    expect(logger.info).toHaveBeenCalledWith("Reenvio da DLQ concluído", {
      usuario: "admin-42",
      horario: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      quantidadeSolicitada: 12,
      reenviados: 12,
      restantes: 3,
    });
  });
});
