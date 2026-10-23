import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { processarEventoTelemetria } from "../../services/processar-telemetria.service";
import { MetricasValidacaoService } from "../../services/metricas-validacao.service";
import * as sensorRepository from "../../repositories/sensor.repository";
import * as medidaRepository from "../../repositories/medida.repository";
import * as avaliarRegrasService from "../../services/avaliar-regras.service";
import { EventoTelemetriaDTO, SensorEventoRow } from "../../dto/evento-telemetria.dto";
import { AlarmeRow } from "../../dto/alarme.dto";
import logger from "../../utils/logger";

jest.mock("../../repositories/sensor.repository");
jest.mock("../../repositories/medida.repository");
jest.mock("../../services/avaliar-regras.service");

// US-22 (TASK 22.02): quais medidas entram na avaliação e quando o alarme é registrado.
describe("processar-telemetria.service - avaliação das regras (US-22)", () => {
  const queryClientMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();
  const connectPoolMock = jest.fn<() => Promise<unknown>>();
  const agora = new Date("2026-10-24T13:00:01.000Z");
  let inserida: boolean;

  const sensor = (codigo: string, tipo: string, estacaoStatus = "Ativa"): SensorEventoRow => ({
    id: `sensor-${codigo}`,
    estacao_id: "estacao-uuid-1",
    codigo,
    fator: "1.000000",
    ganho: "0.000000",
    status: "Ativo",
    tipo,
    municipio: "São José dos Campos",
    estacao_status: estacaoStatus,
  });

  const evento = (...leituras: Array<[string, number]>): EventoTelemetriaDTO => ({
    staging_id: "staging-uuid-1",
    estacao_uuid: "estacao-uuid-1",
    unixtime: 1792400000,
    leituras: leituras.map(([s, valor]) => ({ sensor: s, valor })),
  });

  const processar = (e: EventoTelemetriaDTO) =>
    processarEventoTelemetria(e, {
      dbPool: { connect: connectPoolMock as never },
      agora: () => agora,
      metricas: new MetricasValidacaoService(),
    });

  const usarSensores = (...sensores: SensorEventoRow[]) => {
    jest
      .mocked(sensorRepository.buscarSensoresPorEvento)
      .mockResolvedValue(new Map(sensores.map((s) => [s.codigo, s])));
  };

  const avaliadas = () => jest.mocked(avaliarRegrasService.avaliarRegrasDasMedidas).mock.calls[0]?.[0] ?? [];

  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    inserida = true;
    queryClientMock.mockResolvedValue({ rows: [] });
    connectPoolMock.mockResolvedValue({
      query: queryClientMock,
      release: jest.fn(),
      on: jest.fn(),
      removeListener: jest.fn(),
    });
    jest.mocked(avaliarRegrasService.avaliarRegrasDasMedidas).mockResolvedValue({ abertos: [], normalizados: [] });
    jest
      .mocked(medidaRepository.inserirMedidaIdempotente)
      .mockImplementation(async (dados) => ({
        inserida,
        medida: {
          id: `medida-${dados.sensor_id}`,
          sensor_id: dados.sensor_id,
          unixtime: String(dados.unixtime),
          valor_bruto: String(dados.valor_bruto),
          valor: String(dados.valor),
          valida: dados.valida ?? true,
          staging_id: dados.staging_id,
          criado_em: dados.criado_em,
        },
      }));
  });

  it("avalia a medida nova e válida com o valor calibrado, o município e o horário da leitura", async () => {
    usarSensores(sensor("PM25-01", "PM2.5"));

    await processar(evento(["PM25-01", 52.3]));

    expect(avaliadas()).toEqual([
      {
        medida_id: "medida-sensor-PM25-01",
        sensor_id: "sensor-PM25-01",
        estacao_id: "estacao-uuid-1",
        municipio: "São José dos Campos",
        valor: "52.30",
        lido_em: new Date(1792400000 * 1000),
      },
    ]);
  });

  it("avalia dentro da transação, antes do COMMIT, com o cliente da transação", async () => {
    usarSensores(sensor("PM25-01", "PM2.5"));
    jest.mocked(avaliarRegrasService.avaliarRegrasDasMedidas).mockImplementation(async (_m, _a, db) => {
      expect(queryClientMock.mock.calls.map(([sql]) => sql)).toEqual(["BEGIN"]);
      expect(db).toEqual(expect.objectContaining({ query: queryClientMock }));
      return { abertos: [], normalizados: [] };
    });

    await processar(evento(["PM25-01", 52.3]));

    expect(queryClientMock).toHaveBeenLastCalledWith("COMMIT");
  });

  it("medida inválida (US-19) não entra na avaliação", async () => {
    usarSensores(sensor("UR-01", "Umidade Relativa"), sensor("PM25-01", "PM2.5"));

    await processar(evento(["UR-01", 120], ["PM25-01", 10]));

    expect(avaliadas().map((m) => m.sensor_id)).toEqual(["sensor-PM25-01"]);
  });

  it("medida de estação inativa é gravada, mas não entra na avaliação", async () => {
    usarSensores(sensor("PM25-01", "PM2.5", "Inativa"));

    await processar(evento(["PM25-01", 80]));

    expect(medidaRepository.inserirMedidaIdempotente).toHaveBeenCalledTimes(1);
    expect(avaliadas()).toEqual([]);
  });

  it("estação com falha continua sendo avaliada", async () => {
    usarSensores(sensor("PM25-01", "PM2.5", "Com Falha"));

    await processar(evento(["PM25-01", 80]));

    expect(avaliadas()).toHaveLength(1);
  });

  it("evento entregue de novo (medida já existente) não é avaliado outra vez", async () => {
    inserida = false;
    usarSensores(sensor("PM25-01", "PM2.5"));

    await processar(evento(["PM25-01", 52.3]));

    expect(avaliadas()).toEqual([]);
  });

  it("devolve os alarmes e registra cada um em log só depois do COMMIT", async () => {
    const warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    const alarme = {
      id: "alarme-1",
      regra_id: "regra-1",
      sensor_id: "sensor-PM25-01",
      municipio: "São José dos Campos",
      valor: "52.300000",
      operador: ">=",
      limite: "50.00",
      severidade: "CRITICO",
    } as AlarmeRow;
    jest.mocked(avaliarRegrasService.avaliarRegrasDasMedidas).mockResolvedValue({
      abertos: [alarme],
      normalizados: [{ id: "alarme-0", regra_id: "regra-0" }],
    });
    usarSensores(sensor("PM25-01", "PM2.5"));

    const resultado = await processar(evento(["PM25-01", 52.3]));

    expect(resultado.alarmesAbertos).toEqual([alarme]);
    expect(resultado.alarmesNormalizados).toBe(1);
    expect(warn).toHaveBeenCalledWith("Alarme registrado: medida violou regra de alerta", {
      alarme_id: "alarme-1",
      regra_id: "regra-1",
      sensor_id: "sensor-PM25-01",
      municipio: "São José dos Campos",
      valor: "52.300000",
      operador: ">=",
      limite: "50.00",
      severidade: "CRITICO",
    });
  });

  it("falha na avaliação desfaz a transação inteira, inclusive a medida, e não registra alarme", async () => {
    const warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    jest.spyOn(logger, "error").mockImplementation(() => undefined);
    jest.mocked(avaliarRegrasService.avaliarRegrasDasMedidas).mockRejectedValue(new Error("falha na avaliação"));
    usarSensores(sensor("PM25-01", "PM2.5"));

    await expect(processar(evento(["PM25-01", 52.3]))).rejects.toThrow("falha na avaliação");

    expect(queryClientMock).toHaveBeenLastCalledWith("ROLLBACK");
    expect(warn).not.toHaveBeenCalledWith("Alarme registrado: medida violou regra de alerta", expect.anything());
  });
});
