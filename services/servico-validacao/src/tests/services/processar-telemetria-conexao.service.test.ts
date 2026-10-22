import { EventEmitter } from "node:events";
import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { processarEventoTelemetria } from "../../services/processar-telemetria.service";
import * as sensorRepository from "../../repositories/sensor.repository";
import logger from "../../utils/logger";

jest.mock("../../repositories/sensor.repository");
jest.mock("../../repositories/medida.repository");

// US-20: a queda da conexão no meio da transação não pode derrubar o processo.
describe("processar-telemetria.service - conexão perdida durante a transação (US-20)", () => {
  let client: EventEmitter & { query: jest.Mock; release: jest.Mock };

  const evento = {
    staging_id: "staging-uuid-1",
    estacao_uuid: "estacao-uuid-1",
    unixtime: 1792400000,
    leituras: [{ sensor: "T-01", valor: 20 }],
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(logger, "error").mockImplementation(() => undefined);
    client = Object.assign(new EventEmitter(), {
      query: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    });
  });

  it("registra a perda da conexão, propaga a falha e descarta o cliente em vez de devolvê-lo ao pool", async () => {
    const queda = new Error("Connection terminated unexpectedly");
    jest.mocked(sensorRepository.buscarSensoresPorEvento).mockImplementation(async () => {
      // O pg emite "error" no cliente e rejeita a consulta em andamento.
      client.emit("error", queda);
      throw queda;
    });

    await expect(
      processarEventoTelemetria(evento, {
        dbPool: { connect: (async () => client) as never },
      }),
    ).rejects.toBe(queda);

    expect(logger.error).toHaveBeenCalledWith(
      "Conexão com o PostgreSQL perdida durante a transação",
      { staging_id: "staging-uuid-1", erro: "Connection terminated unexpectedly" },
    );
    expect(client.release).toHaveBeenCalledWith(queda);
    expect(client.listenerCount("error")).toBe(0);
  });

  it("transação sem queda devolve o cliente ao pool normalmente", async () => {
    jest.mocked(sensorRepository.buscarSensoresPorEvento).mockResolvedValue(new Map());

    await processarEventoTelemetria(evento, {
      dbPool: { connect: (async () => client) as never },
    });

    expect(client.release).toHaveBeenCalledWith(undefined);
    expect(client.listenerCount("error")).toBe(0);
  });
});
