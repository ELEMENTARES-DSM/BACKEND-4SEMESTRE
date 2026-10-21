import { describe, it, expect, jest } from "@jest/globals";
import {
  concluirLeiturasIgnoradas,
  ConcluirLeiturasIgnoradasDeps,
  MOTIVO_SENSOR_INEXISTENTE,
  PublicarLeituraNaDlq,
} from "../../services/processar-leituras.service";
import {
  EventoTelemetriaDTO,
  SensorEventoRow,
} from "../../dto/evento-telemetria.dto";

type RegistrarInativa = NonNullable<ConcluirLeiturasIgnoradasDeps["registrarInativa"]>;

const ESTACAO = "e30a57e3-0d33-4f9e-86b2-6cb1690a7891";
const UNIXTIME = 1792411200;

const evento: EventoTelemetriaDTO = {
  staging_id: "staging-1",
  estacao_uuid: ESTACAO,
  unixtime: UNIXTIME,
  leituras: [
    { sensor: "T-01", valor: 25.4 },
    { sensor: "PM-01", valor: 12 },
    { sensor: "X-99", valor: 7 },
  ],
};

const sensorInativo = (codigo: string): SensorEventoRow => ({
  id: `sensor-${codigo}-id`,
  estacao_id: ESTACAO,
  codigo,
  fator: "1.000000",
  ganho: "0.000000",
  status: "Inativo",
  municipio: "São José dos Campos",
});

describe("concluirLeiturasIgnoradas", () => {
  it("publica as inexistentes na DLQ antes de registrar as inativas", async () => {
    const ordem: string[] = [];
    const publicarLeituraNaDlq = jest
      .fn<PublicarLeituraNaDlq>()
      .mockImplementation(async ({ leitura }) => {
        ordem.push(`dlq:${leitura.sensor}`);
      });
    const registrarInativa = jest.fn<RegistrarInativa>().mockImplementation(({ codigo }) => {
      ordem.push(`inativa:${codigo}`);
    });

    await concluirLeiturasIgnoradas(
      evento,
      {
        inexistentes: [{ sensor: "X-99", valor: 7 }],
        inativas: [{ leitura: { sensor: "PM-01", valor: 12 }, sensor: sensorInativo("PM-01") }],
      },
      { publicarLeituraNaDlq, registrarInativa },
    );

    expect(ordem).toEqual(["dlq:X-99", "inativa:PM-01"]);
    expect(publicarLeituraNaDlq).toHaveBeenCalledWith({
      evento,
      leitura: { sensor: "X-99", valor: 7 },
      motivo: MOTIVO_SENSOR_INEXISTENTE,
    });
    expect(registrarInativa).toHaveBeenCalledWith({
      estacaoId: ESTACAO,
      codigo: "PM-01",
      unixtime: UNIXTIME,
      valorBruto: 12,
    });
  });

  it("propaga o erro da DLQ e não registra as inativas", async () => {
    const erro = new Error("falha ao publicar na DLQ");
    const publicarLeituraNaDlq = jest.fn<PublicarLeituraNaDlq>().mockRejectedValue(erro);
    const registrarInativa = jest.fn<RegistrarInativa>();

    await expect(
      concluirLeiturasIgnoradas(
        evento,
        {
          inexistentes: [{ sensor: "X-99", valor: 7 }],
          inativas: [{ leitura: { sensor: "PM-01", valor: 12 }, sensor: sensorInativo("PM-01") }],
        },
        { publicarLeituraNaDlq, registrarInativa },
      ),
    ).rejects.toBe(erro);
    expect(registrarInativa).not.toHaveBeenCalled();
  });

  it("não chama a DLQ quando não há inexistentes", async () => {
    const publicarLeituraNaDlq = jest.fn<PublicarLeituraNaDlq>();
    const registrarInativa = jest.fn<RegistrarInativa>();

    await concluirLeiturasIgnoradas(
      evento,
      {
        inexistentes: [],
        inativas: [{ leitura: { sensor: "PM-01", valor: 12 }, sensor: sensorInativo("PM-01") }],
      },
      { publicarLeituraNaDlq, registrarInativa },
    );

    expect(publicarLeituraNaDlq).not.toHaveBeenCalled();
    expect(registrarInativa).toHaveBeenCalledTimes(1);
  });

  it("todos inativos: registra cada leitura e não chama a DLQ", async () => {
    const publicarLeituraNaDlq = jest.fn<PublicarLeituraNaDlq>();
    const registrarInativa = jest.fn<RegistrarInativa>();

    await concluirLeiturasIgnoradas(
      evento,
      {
        inexistentes: [],
        inativas: ["T-01", "U-01", "PM-01"].map((codigo, i) => ({
          leitura: { sensor: codigo, valor: i + 1 },
          sensor: sensorInativo(codigo),
        })),
      },
      { publicarLeituraNaDlq, registrarInativa },
    );

    expect(publicarLeituraNaDlq).not.toHaveBeenCalled();
    expect(registrarInativa).toHaveBeenCalledTimes(3);
    expect(registrarInativa.mock.calls.map(([dados]) => dados.codigo)).toEqual([
      "T-01",
      "U-01",
      "PM-01",
    ]);
  });
});
