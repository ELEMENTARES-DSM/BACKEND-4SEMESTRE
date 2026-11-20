import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { processarEventoTelemetria } from "../../services/processar-telemetria.service";
import { MetricasValidacaoService } from "../../services/metricas-validacao.service";
import * as sensorRepository from "../../repositories/sensor.repository";
import * as medidaRepository from "../../repositories/medida.repository";
import * as regraAlertaRepository from "../../repositories/regra-alerta.repository";
import * as alarmeRepository from "../../repositories/alarme.repository";
import { EventoTelemetriaDTO, SensorEventoRow } from "../../dto/evento-telemetria.dto";
import logger from "../../utils/logger";
import { faixaDoCatalogo } from "../helpers/catalogo";

jest.mock("../../repositories/sensor.repository");
jest.mock("../../repositories/medida.repository");
// US-22: a avaliação das regras tem testes próprios; aqui nenhum sensor tem regra.
jest.mock("../../repositories/regra-alerta.repository");
jest.mock("../../repositories/alarme.repository");

// US-19 (TASKS 19.01 e 19.02): fora da faixa física grava com valida falso, log e contador.
describe("processar-telemetria.service - faixa física (US-19)", () => {
  const queryClientMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();
  const connectPoolMock = jest.fn<() => Promise<unknown>>();
  let metricas: MetricasValidacaoService;
  let inserida: boolean;

  // A faixa e a unidade vêm do catálogo (JOIN com tipos_sensor); `extras` troca
  // qualquer campo da linha, por exemplo a faixa que o Administrador alterou.
  const sensor = (
    codigo: string,
    tipo: string,
    fatorConversao = "1.000000",
    extras: Partial<SensorEventoRow> = {},
  ): SensorEventoRow => ({
    id: `sensor-${codigo}`,
    estacao_id: "estacao-uuid-1",
    codigo,
    fator_conversao: fatorConversao,
    offset: "0.000000",
    status: "Ativo",
    tipo,
    ...faixaDoCatalogo(tipo),
    municipio: "São José dos Campos",
    estacao_status: "Ativa",
    ...extras,
  });

  const evento = (...leituras: Array<[string, number]>): EventoTelemetriaDTO => ({
    staging_id: "staging-uuid-1",
    estacao_uuid: "estacao-uuid-1",
    unixtime: 1792400000,
    leituras: leituras.map(([sensor, valor]) => ({ sensor, valor })),
  });

  const processar = (e: EventoTelemetriaDTO) =>
    processarEventoTelemetria(e, {
      dbPool: { connect: connectPoolMock as never },
      agora: () => new Date("2026-10-20T13:00:00.000Z"),
      metricas,
    });

  const validaGravada = (codigo: string) => {
    const chamada = jest
      .mocked(medidaRepository.inserirMedidaIdempotente)
      .mock.calls.find(([dados]) => dados.sensor_id === `sensor-${codigo}`);
    return chamada?.[0].valida;
  };

  const usarSensores = (...sensores: SensorEventoRow[]) => {
    jest
      .mocked(sensorRepository.buscarSensoresPorEvento)
      .mockResolvedValue(new Map(sensores.map((s) => [s.codigo, s])));
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    metricas = new MetricasValidacaoService();
    jest.mocked(regraAlertaRepository.buscarRegrasAtivasPorSensores).mockResolvedValue([]);
    jest.mocked(alarmeRepository.normalizarAlarmesDeRegrasInativas).mockResolvedValue([]);
    inserida = true;
    queryClientMock.mockResolvedValue({ rows: [] });
    connectPoolMock.mockResolvedValue({
      query: queryClientMock,
      release: jest.fn(),
      on: jest.fn(),
      removeListener: jest.fn(),
    });
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

  it("valor dentro da faixa é gravado com valida verdadeiro", async () => {
    usarSensores(sensor("T-01", "Temperatura"));

    const resultado = await processar(evento(["T-01", 23.4]));

    expect(validaGravada("T-01")).toBe(true);
    expect(resultado.invalidasGravadas).toBe(0);
    expect(metricas.obterMetricas().medidasInvalidasGravadas).toBe(0);
  });

  it("umidade 120,0 é gravada com valor real 120,00, valida falso, log e contador", async () => {
    const warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    usarSensores(sensor("UR-01", "Umidade Relativa"));

    const resultado = await processar(evento(["UR-01", 120.0]));

    expect(medidaRepository.inserirMedidaIdempotente).toHaveBeenCalledWith(
      expect.objectContaining({ valor_bruto: 120, valor: "120.00", valida: false }),
      expect.anything(),
    );
    expect(resultado.recusadas).toEqual([]);
    expect(resultado.invalidasGravadas).toBe(1);
    expect(metricas.obterMetricas().medidasInvalidasGravadas).toBe(1);
    expect(warn).toHaveBeenCalledWith("Medida gravada como inválida: valor fora da faixa física", {
      estacao_uuid: "estacao-uuid-1",
      sensor_codigo: "UR-01",
      unixtime: 1792400000,
      valor_bruto: 120,
      valor_real: "120.00",
      faixa_esperada: "0.00 a 100.00 %",
    });
  });

  it.each([
    [0.0, true],
    [100.0, true],
    [100.1, false],
    [-0.1, false],
  ])("limites da umidade: %s grava com valida %s", async (valor, valida) => {
    jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    usarSensores(sensor("UR-01", "Umidade Relativa"));

    await processar(evento(["UR-01", valor]));

    expect(validaGravada("UR-01")).toBe(valida);
  });

  it("confere o valor real e não o bruto: bruto 512 com fator 0,1 vira 51,20 e é válido", async () => {
    usarSensores(sensor("UR-01", "Umidade Relativa", "0.100000"));

    await processar(evento(["UR-01", 512]));

    expect(medidaRepository.inserirMedidaIdempotente).toHaveBeenCalledWith(
      expect.objectContaining({ valor: "51.20", valida: true }),
      expect.anything(),
    );
  });

  it("arredonda antes de conferir: 100,004 vira 100,00 e é válido", async () => {
    usarSensores(sensor("UR-01", "Umidade Relativa"));

    await processar(evento(["UR-01", 100.004]));

    expect(medidaRepository.inserirMedidaIdempotente).toHaveBeenCalledWith(
      expect.objectContaining({ valor: "100.00", valida: true }),
      expect.anything(),
    );
  });

  it("o mesmo 70,0 é inválido para temperatura e válido para vento", async () => {
    jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    usarSensores(sensor("T-01", "Temperatura"), sensor("V-01", "Velocidade do Vento"));

    await processar(evento(["T-01", 70], ["V-01", 70]));

    expect(validaGravada("T-01")).toBe(false);
    expect(validaGravada("V-01")).toBe(true);
  });

  it("mensagem com válida e inválida grava as duas na mesma transação", async () => {
    jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    usarSensores(sensor("T-01", "Temperatura"), sensor("UR-01", "Umidade Relativa"));

    const resultado = await processar(evento(["T-01", 23.4], ["UR-01", 120]));

    expect(resultado.inseridas).toBe(2);
    expect(resultado.invalidasGravadas).toBe(1);
    expect(queryClientMock.mock.calls.map(([sql]) => sql)).toEqual(["BEGIN", "COMMIT"]);
  });

  it("evento entregue de novo não grava de novo e não soma no contador", async () => {
    const warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    usarSensores(sensor("UR-01", "Umidade Relativa"));
    inserida = false;

    const resultado = await processar(evento(["UR-01", 120]));

    expect(resultado.invalidasGravadas).toBe(0);
    expect(metricas.obterMetricas().medidasInvalidasGravadas).toBe(0);
    expect(warn).not.toHaveBeenCalledWith(
      "Medida gravada como inválida: valor fora da faixa física",
      expect.anything(),
    );
  });

  describe("faixa vinda do catálogo (US-39)", () => {
    it("Cenário 2: precipitação 12,4 mm é gravada como 12,40 e válida", async () => {
      // Dado
      usarSensores(sensor("CHUVA-01", "Precipitação"));

      // Quando
      const resultado = await processar(evento(["CHUVA-01", 12.4]));

      // Então
      expect(medidaRepository.inserirMedidaIdempotente).toHaveBeenCalledWith(
        expect.objectContaining({ valor_bruto: 12.4, valor: "12.40", valida: true }),
        expect.anything(),
      );
      expect(resultado.invalidasGravadas).toBe(0);
    });

    it("Cenário 3: umidade 120 fica inválida pela faixa do catálogo e a medida é gravada", async () => {
      // Dado
      jest.spyOn(logger, "warn").mockImplementation(() => undefined);
      usarSensores(sensor("UR-01", "Umidade Relativa"));

      // Quando
      const resultado = await processar(evento(["UR-01", 120]));

      // Então
      expect(validaGravada("UR-01")).toBe(false);
      expect(resultado.inseridas).toBe(1);
      expect(resultado.invalidasGravadas).toBe(1);
    });

    it("Cenário 5: sensor em Kelvin com offset -273,15, bruto 300 vira 26,85 °C e é válido", async () => {
      // Dado
      usarSensores(sensor("TEMP-K", "Temperatura", "1.000000", { offset: "-273.150000" }));

      // Quando
      await processar(evento(["TEMP-K", 300]));

      // Então
      expect(medidaRepository.inserirMedidaIdempotente).toHaveBeenCalledWith(
        expect.objectContaining({ valor_bruto: 300, valor: "26.85", valida: true }),
        expect.anything(),
      );
    });

    it("sensor em Kelvin com bruto 400 vira 126,85 °C e fica inválido (acima de 60)", async () => {
      // Dado
      jest.spyOn(logger, "warn").mockImplementation(() => undefined);
      usarSensores(sensor("TEMP-K", "Temperatura", "1.000000", { offset: "-273.150000" }));

      // Quando
      await processar(evento(["TEMP-K", 400]));

      // Então
      expect(medidaRepository.inserirMedidaIdempotente).toHaveBeenCalledWith(
        expect.objectContaining({ valor: "126.85", valida: false }),
        expect.anything(),
      );
    });

    it.each([
      [360, true],
      [400, false],
    ])("direção do vento %s grava com valida %s", async (valor, valida) => {
      // Dado
      jest.spyOn(logger, "warn").mockImplementation(() => undefined);
      usarSensores(sensor("DIR-01", "Direção do Vento"));

      // Quando
      await processar(evento(["DIR-01", valor]));

      // Então
      expect(validaGravada("DIR-01")).toBe(valida);
    });

    it("grandeza nova do catálogo, que não existe no código, usa a faixa e a unidade da linha do sensor", async () => {
      // Dado: o Administrador cadastrou "Nebulosidade" de 0 a 8 oitavos
      const warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
      const nebulosidade = {
        tipo: "Nebulosidade",
        faixa_min: "0.00",
        faixa_max: "8.00",
        unidade: "oitavos",
      };
      usarSensores(
        sensor("NEB-01", "Temperatura", "1.000000", nebulosidade),
        sensor("NEB-02", "Temperatura", "1.000000", nebulosidade),
      );

      // Quando
      await processar(evento(["NEB-01", 8], ["NEB-02", 9]));

      // Então: 8 é o limite (válido) e 9 passa dele, com a faixa descrita no log
      expect(validaGravada("NEB-01")).toBe(true);
      expect(validaGravada("NEB-02")).toBe(false);
      expect(warn).toHaveBeenCalledWith(
        "Medida gravada como inválida: valor fora da faixa física",
        expect.objectContaining({ sensor_codigo: "NEB-02", faixa_esperada: "0.00 a 8.00 oitavos" }),
      );
    });

    it("Cenário 7: a faixa alterada no catálogo vale para a próxima leitura (80 passa de válido para inválido)", async () => {
      // Dado: leitura 1 com a faixa antiga (0 a 100) e leitura 2 depois que o Administrador baixou o máximo para 75
      jest.spyOn(logger, "warn").mockImplementation(() => undefined);
      usarSensores(sensor("UR-01", "Umidade Relativa"));
      await processar(evento(["UR-01", 80]));
      const antes = validaGravada("UR-01");

      jest.mocked(medidaRepository.inserirMedidaIdempotente).mockClear();
      usarSensores(sensor("UR-01", "Umidade Relativa", "1.000000", { faixa_max: "75.00" }));

      // Quando
      await processar(evento(["UR-01", 80]));

      // Então
      expect(antes).toBe(true);
      expect(validaGravada("UR-01")).toBe(false);
    });
  });
});
