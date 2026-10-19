import { describe, it, expect, jest } from "@jest/globals";
import {
  EnviarLeituraParaDlq,
  MOTIVO_SENSOR_INEXISTENTE,
  processarLeiturasDoEvento,
  ProcessarLeiturasDeps,
  SeguirParaUS17,
} from "../../services/processar-leituras.service";
import { BuscarSensor } from "../../services/classificar-leituras.service";
import { EventoTelemetria } from "../../dto/evento-telemetria.dto";
import { SensorDaEstacao } from "../../models/sensor.model";

type RegistrarInativa = NonNullable<ProcessarLeiturasDeps["registrarInativa"]>;

const ESTACAO = "e30a57e3-0d33-4f9e-86b2-6cb1690a7891";
const UNIXTIME = 1792411200;

const sensor = (codigo: string, status: SensorDaEstacao["status"]): SensorDaEstacao => ({
  id: `id-${codigo}`,
  codigo,
  status,
  fator: 1.1,
  ganho: 0.5,
});

const evento = (leituras: EventoTelemetria["leituras"]): EventoTelemetria => ({
  staging_id: "staging-1",
  estacao_uuid: ESTACAO,
  unixtime: UNIXTIME,
  leituras,
});

const criarDeps = (tabela: Record<string, SensorDaEstacao | null>) => {
  const deps = {
    seguirParaUS17: jest.fn<SeguirParaUS17>().mockResolvedValue(undefined),
    enviarLeituraParaDlq: jest.fn<EnviarLeituraParaDlq>().mockResolvedValue(undefined),
    buscarSensor: jest.fn<BuscarSensor>(async (_estacaoId, codigo) => tabela[codigo] ?? null),
    registrarInativa: jest.fn<RegistrarInativa>(),
  };
  return deps;
};

describe("processarLeiturasDoEvento", () => {
  it("a) separa ativo, inativo e inexistente no mesmo evento", async () => {
    const t01 = sensor("T-01", "Ativo");
    const deps = criarDeps({ "T-01": t01, "PM-01": sensor("PM-01", "Inativo") });
    const ev = evento([
      { sensor: "T-01", valor: 25.4 },
      { sensor: "PM-01", valor: 12 },
      { sensor: "X-99", valor: 7 },
    ]);

    const res = await processarLeiturasDoEvento(ev, deps);

    expect(deps.seguirParaUS17).toHaveBeenCalledTimes(1);
    expect(deps.seguirParaUS17).toHaveBeenCalledWith(
      [{ leitura: { sensor: "T-01", valor: 25.4 }, sensor: t01 }],
      ev,
    );
    expect(deps.enviarLeituraParaDlq).toHaveBeenCalledTimes(1);
    expect(deps.enviarLeituraParaDlq).toHaveBeenCalledWith(
      { sensor: "X-99", valor: 7 },
      ev,
      MOTIVO_SENSOR_INEXISTENTE,
    );
    expect(deps.registrarInativa).toHaveBeenCalledTimes(1);
    expect(deps.registrarInativa).toHaveBeenCalledWith({
      estacaoId: ESTACAO,
      codigo: "PM-01",
      unixtime: UNIXTIME,
      valorBruto: 12,
    });
    expect(res).toEqual({ gravadas: 1, ignoradasInativas: 1, enviadasDlq: 1 });
  });

  it("b) todos inativos: não grava nem envia para a DLQ, registra cada um", async () => {
    const deps = criarDeps({
      "T-01": sensor("T-01", "Inativo"),
      "U-01": sensor("U-01", "Inativo"),
      "PM-01": sensor("PM-01", "Inativo"),
    });

    const res = await processarLeiturasDoEvento(
      evento([
        { sensor: "T-01", valor: 1 },
        { sensor: "U-01", valor: 2 },
        { sensor: "PM-01", valor: 3 },
      ]),
      deps,
    );

    expect(deps.seguirParaUS17).not.toHaveBeenCalled();
    expect(deps.enviarLeituraParaDlq).not.toHaveBeenCalled();
    expect(deps.registrarInativa).toHaveBeenCalledTimes(3);
    expect(res).toEqual({ gravadas: 0, ignoradasInativas: 3, enviadasDlq: 0 });
  });

  it("c) sensor reativado volta a seguir para a US-17 no evento seguinte", async () => {
    const tabela: Record<string, SensorDaEstacao | null> = {
      "PM-01": sensor("PM-01", "Inativo"),
    };
    const deps = criarDeps(tabela);
    const ev = evento([{ sensor: "PM-01", valor: 12 }]);

    await processarLeiturasDoEvento(ev, deps);
    expect(deps.seguirParaUS17).not.toHaveBeenCalled();
    expect(deps.registrarInativa).toHaveBeenCalledTimes(1);

    tabela["PM-01"] = sensor("PM-01", "Ativo");
    const res = await processarLeiturasDoEvento(ev, deps);

    expect(deps.seguirParaUS17).toHaveBeenCalledTimes(1);
    expect(deps.seguirParaUS17).toHaveBeenCalledWith(
      [{ leitura: { sensor: "PM-01", valor: 12 }, sensor: tabela["PM-01"] }],
      ev,
    );
    expect(deps.registrarInativa).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ gravadas: 1, ignoradasInativas: 0, enviadasDlq: 0 });
  });

  it("d) erro em seguirParaUS17 propaga e não envia DLQ nem registra inativas", async () => {
    const erro = new Error("falha ao gravar medidas");
    const deps = criarDeps({ "T-01": sensor("T-01", "Ativo"), "PM-01": sensor("PM-01", "Inativo") });
    deps.seguirParaUS17.mockRejectedValue(erro);

    await expect(
      processarLeiturasDoEvento(
        evento([
          { sensor: "T-01", valor: 25 },
          { sensor: "PM-01", valor: 12 },
          { sensor: "X-99", valor: 7 },
        ]),
        deps,
      ),
    ).rejects.toBe(erro);
    expect(deps.enviarLeituraParaDlq).not.toHaveBeenCalled();
    expect(deps.registrarInativa).not.toHaveBeenCalled();
  });

  it("e) erro em enviarLeituraParaDlq propaga e não registra inativas", async () => {
    const erro = new Error("falha ao publicar na DLQ");
    const deps = criarDeps({ "PM-01": sensor("PM-01", "Inativo") });
    deps.enviarLeituraParaDlq.mockRejectedValue(erro);

    await expect(
      processarLeiturasDoEvento(
        evento([
          { sensor: "PM-01", valor: 12 },
          { sensor: "X-99", valor: 7 },
        ]),
        deps,
      ),
    ).rejects.toBe(erro);
    expect(deps.registrarInativa).not.toHaveBeenCalled();
  });
});
