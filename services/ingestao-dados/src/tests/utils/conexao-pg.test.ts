import { EventEmitter } from "events";
import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { PoolClient } from "pg";
import { protegerCliente } from "../../utils/conexao-pg";
import { logger } from "../../utils/logger";

// Unitário de protegerCliente: o cliente do PostgreSQL é falso.
describe("protegerCliente", () => {
  let client: EventEmitter & { release: jest.Mock };

  beforeEach(() => {
    client = Object.assign(new EventEmitter(), { release: jest.fn() });
    jest.spyOn(logger, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("deve registrar em log e não derrubar o processo quando a conexão cai com o cliente em uso", () => {
    // Dado (Arrange)
    protegerCliente(client as unknown as PoolClient, "gravar mensagem aceita no staging");

    // Quando (Act)
    const emitir = () => client.emit("error", new Error("Connection terminated unexpectedly"));

    // Então (Assert)
    expect(emitir).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith("Conexão com o PostgreSQL perdida", {
      contexto: "gravar mensagem aceita no staging",
      erro: "Connection terminated unexpectedly",
    });
  });

  it("deve devolver o cliente ao pool quando a conexão não caiu", () => {
    // Dado (Arrange)
    const liberar = protegerCliente(client as unknown as PoolClient, "teste");

    // Quando (Act)
    liberar();

    // Então (Assert)
    expect(client.release).toHaveBeenCalledWith(undefined);
    expect(client.listenerCount("error")).toBe(0);
  });

  it("deve descartar o cliente quando a conexão caiu", () => {
    // Dado (Arrange)
    const liberar = protegerCliente(client as unknown as PoolClient, "teste");
    const queda = new Error("Connection terminated unexpectedly");
    client.emit("error", queda);

    // Quando (Act)
    liberar();

    // Então (Assert)
    expect(client.release).toHaveBeenCalledWith(queda);
    expect(client.listenerCount("error")).toBe(0);
  });
});
