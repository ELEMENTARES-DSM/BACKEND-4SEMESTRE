import { describe, it, expect, jest } from "@jest/globals";
import {
  BuscarSensor,
  classificarLeituras,
} from "../../services/classificar-leituras.service";
import { EventoTelemetria } from "../../dto/evento-telemetria.dto";
import { SensorDaEstacao } from "../../models/sensor.model";

const ESTACAO = "e30a57e3-0d33-4f9e-86b2-6cb1690a7891";

const sensor = (codigo: string, status: SensorDaEstacao["status"]): SensorDaEstacao => ({
  id: `id-${codigo}`,
  codigo,
  status,
  fator: 1,
  ganho: 0,
});

const evento = (leituras: EventoTelemetria["leituras"]): EventoTelemetria => ({
  staging_id: "staging-1",
  estacao_uuid: ESTACAO,
  unixtime: 1792411200,
  leituras,
});

const buscarPorTabela = (tabela: Record<string, SensorDaEstacao | null>) =>
  jest.fn<BuscarSensor>(async (_estacaoId, codigo) => tabela[codigo] ?? null);

describe("classificarLeituras", () => {
  it("deve classificar sensor ativo como válida", async () => {
    const t01 = sensor("T-01", "Ativo");
    const buscarSensor = buscarPorTabela({ "T-01": t01 });

    const res = await classificarLeituras(evento([{ sensor: "T-01", valor: 25 }]), { buscarSensor });

    expect(res).toEqual({
      validas: [{ leitura: { sensor: "T-01", valor: 25 }, sensor: t01 }],
      inativas: [],
      inexistentes: [],
    });
  });

  it("deve classificar sensor inativo como inativa", async () => {
    const pm01 = sensor("PM-01", "Inativo");
    const buscarSensor = buscarPorTabela({ "PM-01": pm01 });

    const res = await classificarLeituras(evento([{ sensor: "PM-01", valor: 12 }]), { buscarSensor });

    expect(res).toEqual({
      validas: [],
      inativas: [{ leitura: { sensor: "PM-01", valor: 12 }, sensor: pm01 }],
      inexistentes: [],
    });
  });

  it("deve classificar sensor não encontrado como inexistente", async () => {
    const buscarSensor = buscarPorTabela({});

    const res = await classificarLeituras(evento([{ sensor: "X-99", valor: 1 }]), { buscarSensor });

    expect(res).toEqual({
      validas: [],
      inativas: [],
      inexistentes: [{ sensor: "X-99", valor: 1 }],
    });
  });

  it("deve preservar a ordem das leituras e consultar cada uma com (estacao_uuid, codigo)", async () => {
    const buscarSensor = buscarPorTabela({
      "A-01": sensor("A-01", "Ativo"),
      "B-01": sensor("B-01", "Inativo"),
      "C-01": sensor("C-01", "Ativo"),
      "D-01": sensor("D-01", "Inativo"),
    });

    const res = await classificarLeituras(
      evento([
        { sensor: "C-01", valor: 3 },
        { sensor: "B-01", valor: 2 },
        { sensor: "Y-01", valor: 9 },
        { sensor: "A-01", valor: 1 },
        { sensor: "D-01", valor: 4 },
        { sensor: "X-01", valor: 8 },
      ]),
      { buscarSensor },
    );

    expect(res.validas.map((v) => v.leitura.sensor)).toEqual(["C-01", "A-01"]);
    expect(res.inativas.map((v) => v.leitura.sensor)).toEqual(["B-01", "D-01"]);
    expect(res.inexistentes.map((l) => l.sensor)).toEqual(["Y-01", "X-01"]);
    expect(buscarSensor.mock.calls).toEqual([
      [ESTACAO, "C-01"],
      [ESTACAO, "B-01"],
      [ESTACAO, "Y-01"],
      [ESTACAO, "A-01"],
      [ESTACAO, "D-01"],
      [ESTACAO, "X-01"],
    ]);
  });

  it("deve consultar o mesmo sensor de novo em outro evento (sem cache)", async () => {
    const buscarSensor = buscarPorTabela({ "T-01": sensor("T-01", "Ativo") });
    const leituras = [{ sensor: "T-01", valor: 25 }];

    await classificarLeituras(evento(leituras), { buscarSensor });
    await classificarLeituras(evento(leituras), { buscarSensor });

    expect(buscarSensor).toHaveBeenCalledTimes(2);
    expect(buscarSensor).toHaveBeenNthCalledWith(1, ESTACAO, "T-01");
    expect(buscarSensor).toHaveBeenNthCalledWith(2, ESTACAO, "T-01");
  });
});
