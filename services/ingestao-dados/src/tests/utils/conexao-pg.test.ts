import { EventEmitter } from "events";
import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { PoolClient } from "pg";
import { protegerCliente } from "../../utils/conexao-pg";
import { logger } from "../../utils/logger";

describe("protegerCliente (TASK 14.03)", () => {
  let client: EventEmitter & { release: jest.Mock };

  beforeEach(() => {
    client = Object.assign(new EventEmitter(), { release: jest.fn() });
    jest.spyOn(logger, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("queda da conexão com o cliente em uso é registrada em log e não derruba o processo", () => {
    protegerCliente(client as unknown as PoolClient, "gravar mensagem aceita no staging");

    expect(() => client.emit("error", new Error("Connection terminated unexpectedly"))).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith("Conexão com o PostgreSQL perdida", {
      contexto: "gravar mensagem aceita no staging",
      erro: "Connection terminated unexpectedly",
    });
  });

  it("libera o cliente para o pool quando a conexão não caiu", () => {
    const liberar = protegerCliente(client as unknown as PoolClient, "teste");

    liberar();

    expect(client.release).toHaveBeenCalledWith(undefined);
    expect(client.listenerCount("error")).toBe(0);
  });

  it("descarta o cliente quando a conexão caiu", () => {
    const liberar = protegerCliente(client as unknown as PoolClient, "teste");
    const queda = new Error("Connection terminated unexpectedly");
    client.emit("error", queda);

    liberar();

    expect(client.release).toHaveBeenCalledWith(queda);
    expect(client.listenerCount("error")).toBe(0);
  });
});
