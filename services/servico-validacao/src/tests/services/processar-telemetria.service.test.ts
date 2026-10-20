import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { processarEventoTelemetria } from "../../services/processar-telemetria.service";
import * as sensorRepository from "../../repositories/sensor.repository";
import * as medidaRepository from "../../repositories/medida.repository";
import logger from "../../utils/logger";

jest.mock("../../repositories/sensor.repository");
jest.mock("../../repositories/medida.repository");

describe("processar-telemetria.service", () => {
  const queryClientMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();
  const releaseClientMock = jest.fn();
  const connectPoolMock = jest.fn<() => Promise<unknown>>();

  const dataFixa = new Date("2026-10-20T13:00:00.000Z");

  const eventoBase = {
    staging_id: "staging-uuid-1",
    estacao_uuid: "estacao-uuid-1",
    unixtime: 1792400000,
    leituras: [
      { sensor: "TEMP-01", valor: 25.4 },
      { sensor: "UMID-01", valor: 60.125 },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    queryClientMock.mockResolvedValue({ rows: [] });
    connectPoolMock.mockResolvedValue({
      query: queryClientMock,
      release: releaseClientMock,
    });
  });

  it("processa todas as leituras de um evento numa única transação, calibrando e gravando em medidas", async () => {
    const mapaSensores = new Map([
      [
        "TEMP-01",
        {
          id: "sensor-temp-id",
          estacao_id: "estacao-uuid-1",
          codigo: "TEMP-01",
          fator: "1.000000",
          ganho: "-0.400000",
          status: "Ativo",
          municipio: "São José dos Campos",
        },
      ],
      [
        "UMID-01",
        {
          id: "sensor-umid-id",
          estacao_id: "estacao-uuid-1",
          codigo: "UMID-01",
          fator: "1.000000",
          ganho: "0.000000",
          status: "Ativo",
          municipio: "São José dos Campos",
        },
      ],
    ]);

    jest
      .mocked(sensorRepository.buscarSensoresPorEvento)
      .mockResolvedValue(mapaSensores);

    jest
      .mocked(medidaRepository.inserirMedidaIdempotente)
      .mockResolvedValueOnce({
        inserida: true,
        medida: {
          id: "medida-1",
          sensor_id: "sensor-temp-id",
          unixtime: "1792400000",
          valor_bruto: "25.400000",
          valor: "25.000000",
          valida: true,
          staging_id: "staging-uuid-1",
          criado_em: dataFixa,
        },
      })
      .mockResolvedValueOnce({
        inserida: true,
        medida: {
          id: "medida-2",
          sensor_id: "sensor-umid-id",
          unixtime: "1792400000",
          valor_bruto: "60.125000",
          valor: "60.130000",
          valida: true,
          staging_id: "staging-uuid-1",
          criado_em: dataFixa,
        },
      });

    const resultado = await processarEventoTelemetria(eventoBase, {
      dbPool: { connect: connectPoolMock as never },
      agora: () => dataFixa,
    });

    expect(queryClientMock).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(sensorRepository.buscarSensoresPorEvento).toHaveBeenCalledTimes(1);
    expect(sensorRepository.buscarSensoresPorEvento).toHaveBeenCalledWith(
      "estacao-uuid-1",
      ["TEMP-01", "UMID-01"],
      expect.objectContaining({ query: queryClientMock }),
    );
    expect(medidaRepository.inserirMedidaIdempotente).toHaveBeenNthCalledWith(
      1,
      {
        sensor_id: "sensor-temp-id",
        unixtime: 1792400000,
        valor_bruto: 25.4,
        valor: "25.00",
        valida: true,
        staging_id: "staging-uuid-1",
        criado_em: dataFixa,
      },
      expect.objectContaining({ query: queryClientMock }),
    );
    expect(medidaRepository.inserirMedidaIdempotente).toHaveBeenNthCalledWith(
      2,
      {
        sensor_id: "sensor-umid-id",
        unixtime: 1792400000,
        valor_bruto: 60.125,
        valor: "60.13",
        valida: true,
        staging_id: "staging-uuid-1",
        criado_em: dataFixa,
      },
      expect.objectContaining({ query: queryClientMock }),
    );
    expect(queryClientMock).toHaveBeenNthCalledWith(2, "COMMIT");
    expect(releaseClientMock).toHaveBeenCalledTimes(1);
    expect(resultado.inseridas).toBe(2);
    expect(resultado.duplicadasIdempotentes).toBe(0);
    expect(resultado.duplicadasDivergentes).toBe(0);
  });

  it("mantém a primeira medida sem logar warn quando duplicata tem o mesmo valor bruto", async () => {
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {});
    const mapaSensores = new Map([
      [
        "TEMP-01",
        {
          id: "sensor-temp-id",
          estacao_id: "estacao-uuid-1",
          codigo: "TEMP-01",
          fator: "1.000000",
          ganho: "0.000000",
          status: "Ativo",
          municipio: "São José dos Campos",
        },
      ],
    ]);

    jest
      .mocked(sensorRepository.buscarSensoresPorEvento)
      .mockResolvedValue(mapaSensores);

    jest.mocked(medidaRepository.inserirMedidaIdempotente).mockResolvedValue({
      inserida: false,
      medida: {
        id: "medida-existente",
        sensor_id: "sensor-temp-id",
        unixtime: "1792400000",
        valor_bruto: "25.400000",
        valor: "25.400000",
        valida: true,
        staging_id: "staging-original",
        criado_em: dataFixa,
      },
    });

    const resultado = await processarEventoTelemetria(
      {
        ...eventoBase,
        leituras: [{ sensor: "TEMP-01", valor: 25.4 }],
      },
      {
        dbPool: { connect: connectPoolMock as never },
        agora: () => dataFixa,
      },
    );

    expect(resultado.inseridas).toBe(0);
    expect(resultado.duplicadasIdempotentes).toBe(1);
    expect(resultado.duplicadasDivergentes).toBe(0);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(queryClientMock).toHaveBeenLastCalledWith("COMMIT");
  });

  it("mantém a primeira medida e registra divergência em log quando duplicata tem valor bruto diferente", async () => {
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {});
    const mapaSensores = new Map([
      [
        "TEMP-01",
        {
          id: "sensor-temp-id",
          estacao_id: "estacao-uuid-1",
          codigo: "TEMP-01",
          fator: "1.000000",
          ganho: "0.000000",
          status: "Ativo",
          municipio: "São José dos Campos",
        },
      ],
    ]);

    jest
      .mocked(sensorRepository.buscarSensoresPorEvento)
      .mockResolvedValue(mapaSensores);

    jest.mocked(medidaRepository.inserirMedidaIdempotente).mockResolvedValue({
      inserida: false,
      medida: {
        id: "medida-existente",
        sensor_id: "sensor-temp-id",
        unixtime: "1792400000",
        valor_bruto: "25.400000",
        valor: "25.400000",
        valida: true,
        staging_id: "staging-original",
        criado_em: dataFixa,
      },
    });

    const resultado = await processarEventoTelemetria(
      {
        ...eventoBase,
        leituras: [{ sensor: "TEMP-01", valor: 28.9 }],
      },
      {
        dbPool: { connect: connectPoolMock as never },
        agora: () => dataFixa,
      },
    );

    expect(resultado.inseridas).toBe(0);
    expect(resultado.duplicadasIdempotentes).toBe(0);
    expect(resultado.duplicadasDivergentes).toBe(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Divergência de valor bruto"),
      expect.objectContaining({
        sensor_id: "sensor-temp-id",
        sensor_codigo: "TEMP-01",
        unixtime: 1792400000,
        valor_bruto_existente: "25.400000",
        valor_bruto_recebido: 28.9,
      }),
    );
    expect(queryClientMock).toHaveBeenLastCalledWith("COMMIT");
  });

  it("executa ROLLBACK e propaga erro quando uma falha ocorre durante a transação", async () => {
    const errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {});
    jest
      .mocked(sensorRepository.buscarSensoresPorEvento)
      .mockRejectedValue(new Error("Falha no banco"));

    await expect(
      processarEventoTelemetria(eventoBase, {
        dbPool: { connect: connectPoolMock as never },
      }),
    ).rejects.toThrow("Falha no banco");

    expect(queryClientMock).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(queryClientMock).toHaveBeenNthCalledWith(2, "ROLLBACK");
    expect(releaseClientMock).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();
  });
});
