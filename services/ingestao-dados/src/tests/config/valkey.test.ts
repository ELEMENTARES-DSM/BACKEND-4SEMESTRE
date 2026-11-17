import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { EventEmitter } from "node:events";
import { createClient } from "redis";
import { encerrarValkey, valkey } from "../../config/valkey";
import { logger } from "../../utils/logger";

// Unitário de valkey/encerrarValkey: o cliente do pacote redis é mockado (sem rede).
jest.mock("redis", () => ({ createClient: jest.fn() }));

type ClienteFalso = EventEmitter & {
  isOpen: boolean;
  connect: jest.Mock<() => Promise<void>>;
  disconnect: jest.Mock<() => Promise<void>>;
};

function clienteFalso(): ClienteFalso {
  return Object.assign(new EventEmitter(), {
    isOpen: true,
    connect: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    disconnect: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  });
}

describe("valkey", () => {
  let cliente: ClienteFalso;

  beforeEach(async () => {
    await encerrarValkey();
    cliente = clienteFalso();
    jest.mocked(createClient).mockReturnValue(cliente as never);
    process.env.REDIS_URL = "redis://:senha@valkey:6379";
  });

  afterEach(async () => {
    await encerrarValkey();
    jest.restoreAllMocks();
  });

  it("deve criar o cliente com a REDIS_URL e sem fila offline, e conectar, quando é chamado pela primeira vez", () => {
    // Dado (Arrange)
    // Quando (Act)
    const resultado = valkey();

    // Então (Assert)
    expect(resultado).toBe(cliente);
    expect(createClient).toHaveBeenCalledWith(expect.objectContaining({
      url: "redis://:senha@valkey:6379",
      disableOfflineQueue: true,
    }));
    expect(cliente.connect).toHaveBeenCalledTimes(1);
  });

  it("deve devolver o mesmo cliente quando é chamado de novo", () => {
    // Dado (Arrange)
    const primeiro = valkey();

    // Quando (Act)
    const segundo = valkey();

    // Então (Assert)
    expect(segundo).toBe(primeiro);
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it("deve registrar no log, sem lançar, quando o cliente emite erro", () => {
    // Dado (Arrange)
    const erroLog = jest.spyOn(logger, "error").mockImplementation(() => undefined);
    valkey();

    // Quando (Act)
    const emitir = () => cliente.emit("error", new Error("ECONNREFUSED"));

    // Então (Assert)
    expect(emitir).not.toThrow();
    expect(erroLog).toHaveBeenCalledWith("Erro no cliente Valkey", { erro: "ECONNREFUSED" });
  });

  it("deve tentar de novo a cada 1 s quando a conexão cai", () => {
    // Dado (Arrange)
    valkey();
    const opcoes = jest.mocked(createClient).mock.calls[0][0] as { socket: { reconnectStrategy: () => number } };

    // Quando (Act)
    const espera = opcoes.socket.reconnectStrategy();

    // Então (Assert)
    expect(espera).toBe(1000);
  });
});

describe("encerrarValkey", () => {
  it("deve desconectar e criar um cliente novo depois quando o cliente está aberto", async () => {
    // Dado (Arrange)
    const primeiro = clienteFalso();
    const segundo = clienteFalso();
    jest.mocked(createClient).mockReturnValueOnce(primeiro as never).mockReturnValueOnce(segundo as never);
    valkey();

    // Quando (Act)
    await encerrarValkey();

    // Então (Assert)
    expect(primeiro.disconnect).toHaveBeenCalledTimes(1);
    expect(valkey()).toBe(segundo);
    await encerrarValkey();
  });

  it("deve não lançar quando ainda não há cliente", async () => {
    // Dado (Arrange)
    await encerrarValkey();

    // Quando (Act)
    const resultado = encerrarValkey();

    // Então (Assert)
    await expect(resultado).resolves.toBeUndefined();
  });
});
