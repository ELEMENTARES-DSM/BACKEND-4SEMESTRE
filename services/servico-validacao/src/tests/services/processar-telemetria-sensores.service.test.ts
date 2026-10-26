import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import {
  EventoMalformadoError,
  processarEventoTelemetria,
} from "../../services/processar-telemetria.service";
import { MetricasValidacaoService } from "../../services/metricas-validacao.service";
import * as sensorRepository from "../../repositories/sensor.repository";
import * as medidaRepository from "../../repositories/medida.repository";
import { EventoTelemetriaDTO, SensorEventoRow } from "../../dto/evento-telemetria.dto";
import logger from "../../utils/logger";

jest.mock("../../repositories/sensor.repository");
jest.mock("../../repositories/medida.repository");

// US-18 (TASK 18.01): sensor inexistente vai para recusadas; sensor inativo é ignorado.
describe("processar-telemetria.service - sensor inexistente ou inativo (US-18)", () => {
  const queryClientMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();
  const releaseClientMock = jest.fn();
  const connectPoolMock = jest.fn<() => Promise<unknown>>();
  const dataFixa = new Date("2026-10-20T13:00:00.000Z");
  let metricas: MetricasValidacaoService;

  const sensor = (codigo: string, status: "Ativo" | "Inativo"): SensorEventoRow => ({
    id: `sensor-${codigo}`,
    estacao_id: "estacao-uuid-1",
    codigo,
    fator: "1.000000",
    ganho: "0.000000",
    status,
    tipo: "Temperatura",
    municipio: "São José dos Campos",
    estacao_status: "Ativa",
  });

  const evento = (...codigos: string[]): EventoTelemetriaDTO => ({
    staging_id: "staging-uuid-1",
    estacao_uuid: "estacao-uuid-1",
    unixtime: 1792400000,
    leituras: codigos.map((codigo, i) => ({ sensor: codigo, valor: 10 + i })),
  });

  const processar = (e: EventoTelemetriaDTO) =>
    processarEventoTelemetria(e, {
      dbPool: { connect: connectPoolMock as never },
      agora: () => dataFixa,
      metricas,
    });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    metricas = new MetricasValidacaoService();
    queryClientMock.mockResolvedValue({ rows: [] });
    connectPoolMock.mockResolvedValue({
      query: queryClientMock,
      release: releaseClientMock,
      on: jest.fn(),
      removeListener: jest.fn(),
    });
    jest
      .mocked(medidaRepository.inserirMedidaIdempotente)
      .mockImplementation(async (dados) => ({
        inserida: true,
        medida: {
          id: `medida-${dados.sensor_id}`,
          sensor_id: dados.sensor_id,
          unixtime: String(dados.unixtime),
          valor_bruto: String(dados.valor_bruto),
          valor: String(dados.valor),
          valida: true,
          staging_id: dados.staging_id,
          criado_em: dados.criado_em,
        },
      }));
  });

  it("T-01 ativo, PM-01 inativo e X-99 inexistente: grava T-01, ignora PM-01 e recusa só X-99", async () => {
    jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    jest
      .mocked(sensorRepository.buscarSensoresPorEvento)
      .mockResolvedValue(new Map([
        ["T-01", sensor("T-01", "Ativo")],
        ["PM-01", sensor("PM-01", "Inativo")],
      ]));

    const resultado = await processar(evento("T-01", "PM-01", "X-99"));

    expect(medidaRepository.inserirMedidaIdempotente).toHaveBeenCalledTimes(1);
    expect(medidaRepository.inserirMedidaIdempotente).toHaveBeenCalledWith(
      expect.objectContaining({ sensor_id: "sensor-T-01", valor_bruto: 10 }),
      expect.anything(),
    );
    expect(resultado.inseridas).toBe(1);
    expect(resultado.recusadas).toEqual([{ sensor: "X-99", valor: 12 }]);
    expect(resultado.ignoradasSensorInativo).toBe(1);
    expect(metricas.obterMetricas().leiturasIgnoradasSensorInativo).toBe(1);
    expect(queryClientMock).toHaveBeenLastCalledWith("COMMIT");
  });

  it("registra a leitura ignorada em log com estação, código, horário e valor bruto", async () => {
    const warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    jest
      .mocked(sensorRepository.buscarSensoresPorEvento)
      .mockResolvedValue(new Map([["PM-01", sensor("PM-01", "Inativo")]]));

    await processar(evento("PM-01"));

    expect(warn).toHaveBeenCalledWith("Leitura ignorada: sensor inativo", {
      estacao_uuid: "estacao-uuid-1",
      sensor_codigo: "PM-01",
      unixtime: 1792400000,
      valor_bruto: 10,
    });
  });

  it("todos os sensores inativos: nenhuma medida, nada recusado e o contador soma o número de leituras", async () => {
    jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    jest
      .mocked(sensorRepository.buscarSensoresPorEvento)
      .mockResolvedValue(new Map([
        ["PM-01", sensor("PM-01", "Inativo")],
        ["UR-01", sensor("UR-01", "Inativo")],
        ["T-01", sensor("T-01", "Inativo")],
      ]));

    const resultado = await processar(evento("PM-01", "UR-01", "T-01"));

    expect(medidaRepository.inserirMedidaIdempotente).not.toHaveBeenCalled();
    expect(resultado.recusadas).toEqual([]);
    expect(resultado.ignoradasSensorInativo).toBe(3);
    expect(metricas.obterMetricas().leiturasIgnoradasSensorInativo).toBe(3);
  });

  it("nenhum sensor existe na estação: nenhuma medida e todas as leituras recusadas", async () => {
    jest
      .mocked(sensorRepository.buscarSensoresPorEvento)
      .mockResolvedValue(new Map());

    const resultado = await processar(evento("X-98", "X-99"));

    expect(medidaRepository.inserirMedidaIdempotente).not.toHaveBeenCalled();
    expect(resultado.recusadas).toEqual([
      { sensor: "X-98", valor: 10 },
      { sensor: "X-99", valor: 11 },
    ]);
    expect(metricas.obterMetricas().leiturasIgnoradasSensorInativo).toBe(0);
  });

  it("sensores todos ativos: grava tudo, nada recusado e o contador não muda", async () => {
    jest
      .mocked(sensorRepository.buscarSensoresPorEvento)
      .mockResolvedValue(new Map([
        ["T-01", sensor("T-01", "Ativo")],
        ["UR-01", sensor("UR-01", "Ativo")],
      ]));

    const resultado = await processar(evento("T-01", "UR-01"));

    expect(resultado.inseridas).toBe(2);
    expect(resultado.recusadas).toEqual([]);
    expect(metricas.obterMetricas().leiturasIgnoradasSensorInativo).toBe(0);
  });

  it("não conta nem registra a ignorada quando a transação falha (o evento volta para a fila)", async () => {
    const warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    jest.spyOn(logger, "error").mockImplementation(() => undefined);
    jest
      .mocked(sensorRepository.buscarSensoresPorEvento)
      .mockResolvedValue(new Map([
        ["T-01", sensor("T-01", "Ativo")],
        ["PM-01", sensor("PM-01", "Inativo")],
      ]));
    jest
      .mocked(medidaRepository.inserirMedidaIdempotente)
      .mockRejectedValue(new Error("Falha no banco"));

    await expect(processar(evento("PM-01", "T-01"))).rejects.toThrow("Falha no banco");

    expect(queryClientMock).toHaveBeenLastCalledWith("ROLLBACK");
    expect(warn).not.toHaveBeenCalled();
    expect(metricas.obterMetricas().leiturasIgnoradasSensorInativo).toBe(0);
  });

  it.each([
    ["sem estação", { estacao_uuid: undefined }],
    ["sem unixtime", { unixtime: undefined }],
    ["sem staging_id", { staging_id: undefined }],
    ["sem leituras", { leituras: undefined }],
    ["com lista de leituras vazia", { leituras: [] }],
    ["com leitura sem valor numérico", { leituras: [{ sensor: "T-01", valor: "dez" }] }],
  ])("evento %s é malformado e não abre transação", async (_caso, alteracao) => {
    const malformado = { ...evento("T-01"), ...alteracao } as unknown as EventoTelemetriaDTO;

    await expect(processar(malformado)).rejects.toBeInstanceOf(EventoMalformadoError);
    expect(connectPoolMock).not.toHaveBeenCalled();
  });
});
