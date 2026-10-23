import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { avaliarRegrasDasMedidas, violaRegra } from "../../services/avaliar-regras.service";
import * as regraAlertaRepository from "../../repositories/regra-alerta.repository";
import * as alarmeRepository from "../../repositories/alarme.repository";
import { AlarmeRow, MedidaParaAvaliar, RegraAtivaRow } from "../../dto/alarme.dto";

jest.mock("../../repositories/regra-alerta.repository");
jest.mock("../../repositories/alarme.repository");

describe("avaliar-regras.service - violaRegra (US-22)", () => {
  it.each([
    ["50.00", ">", "50", false],
    ["50.01", ">", "50", true],
    ["50.00", ">=", "50", true],
    ["49.99", ">=", "50", false],
    ["49.99", "<", "50", true],
    ["50.00", "<", "50", false],
    ["50.00", "<=", "50.00", true],
    ["50.01", "<=", "50", false],
    ["50.00", "=", "50", true],
    ["50.10", "=", "50.1", true],
    ["50.01", "=", "50", false],
    ["-10.50", "<", "-10", true],
  ] as const)("%s %s %s → %s, em decimal exato", (valor, operador, limite, esperado) => {
    expect(violaRegra(valor, operador, limite)).toBe(esperado);
  });

  it("compara o texto decimal sem passar por number: 0.30 é igual a 0.3", () => {
    expect(violaRegra("0.30", "=", "0.3")).toBe(true);
  });
});

describe("avaliar-regras.service - avaliarRegrasDasMedidas (US-22)", () => {
  const db = { query: jest.fn() } as never;
  const agora = new Date("2026-10-24T13:00:01.000Z");
  const lidoEm = new Date("2026-10-24T13:00:00.000Z");

  const medida = (sensor: string, valor: string): MedidaParaAvaliar => ({
    medida_id: `medida-${sensor}`,
    sensor_id: sensor,
    estacao_id: "estacao-1",
    municipio: "São José dos Campos",
    valor,
    lido_em: lidoEm,
  });

  const regra = (id: string, sensor: string, operador: RegraAtivaRow["operador"], limite: string): RegraAtivaRow => ({
    id,
    sensor_id: sensor,
    operador,
    valor_limite: limite,
    severidade: "CRITICO",
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(alarmeRepository.normalizarAlarmesDeRegrasInativas).mockResolvedValue([]);
    jest.mocked(alarmeRepository.normalizarAlarmeAberto).mockResolvedValue(null);
    jest
      .mocked(alarmeRepository.inserirAlarmeAberto)
      .mockImplementation(async (dados) => ({ id: `alarme-${dados.regra_id}`, situacao: "aberto", ...dados }) as AlarmeRow);
  });

  it("sem medidas não consulta o banco", async () => {
    const resultado = await avaliarRegrasDasMedidas([], agora, db);

    expect(resultado).toEqual({ abertos: [], normalizados: [] });
    expect(regraAlertaRepository.buscarRegrasAtivasPorSensores).not.toHaveBeenCalled();
    expect(alarmeRepository.normalizarAlarmesDeRegrasInativas).not.toHaveBeenCalled();
  });

  it("busca as regras de todos os sensores numa só consulta e só compara cada medida com as regras do próprio sensor", async () => {
    jest
      .mocked(regraAlertaRepository.buscarRegrasAtivasPorSensores)
      .mockResolvedValue([regra("r-pm", "pm25", ">=", "50.00"), regra("r-ur", "ur", ">=", "90")]);

    const resultado = await avaliarRegrasDasMedidas(
      [medida("pm25", "52.30"), medida("ur", "60.00")],
      agora,
      db,
    );

    expect(regraAlertaRepository.buscarRegrasAtivasPorSensores).toHaveBeenCalledTimes(1);
    expect(regraAlertaRepository.buscarRegrasAtivasPorSensores).toHaveBeenCalledWith(["pm25", "ur"], db);
    expect(alarmeRepository.inserirAlarmeAberto).toHaveBeenCalledTimes(1);
    expect(alarmeRepository.inserirAlarmeAberto).toHaveBeenCalledWith(
      {
        regra_id: "r-pm",
        medida_id: "medida-pm25",
        sensor_id: "pm25",
        estacao_id: "estacao-1",
        municipio: "São José dos Campos",
        valor: "52.30",
        operador: ">=",
        limite: "50.00",
        severidade: "CRITICO",
        lido_em: lidoEm,
        criado_em: agora,
      },
      db,
    );
    expect(alarmeRepository.normalizarAlarmeAberto).toHaveBeenCalledWith("r-ur", lidoEm, agora, db);
    expect(resultado.abertos.map((a) => a.regra_id)).toEqual(["r-pm"]);
  });

  it("duas regras violadas abrem dois alarmes", async () => {
    jest
      .mocked(regraAlertaRepository.buscarRegrasAtivasPorSensores)
      .mockResolvedValue([regra("r-1", "pm25", ">=", "35"), regra("r-2", "pm25", ">=", "50")]);

    const resultado = await avaliarRegrasDasMedidas([medida("pm25", "52.30")], agora, db);

    expect(resultado.abertos.map((a) => a.regra_id)).toEqual(["r-1", "r-2"]);
  });

  it("alarme já aberto (insert sem linha) não entra no resultado", async () => {
    jest.mocked(regraAlertaRepository.buscarRegrasAtivasPorSensores).mockResolvedValue([regra("r-1", "pm25", ">=", "50")]);
    jest.mocked(alarmeRepository.inserirAlarmeAberto).mockResolvedValue(null);

    const resultado = await avaliarRegrasDasMedidas([medida("pm25", "60.00")], agora, db);

    expect(resultado.abertos).toEqual([]);
  });

  it("devolve os normalizados pela volta ao normal e pela regra inativada", async () => {
    jest.mocked(alarmeRepository.normalizarAlarmesDeRegrasInativas).mockResolvedValue([{ id: "a-velho", regra_id: "r-inativa" }]);
    jest.mocked(regraAlertaRepository.buscarRegrasAtivasPorSensores).mockResolvedValue([regra("r-1", "pm25", ">=", "50")]);
    jest.mocked(alarmeRepository.normalizarAlarmeAberto).mockResolvedValue({ id: "a-1", regra_id: "r-1" });

    const resultado = await avaliarRegrasDasMedidas([medida("pm25", "20.00")], agora, db);

    expect(alarmeRepository.normalizarAlarmesDeRegrasInativas).toHaveBeenCalledWith(["pm25"], agora, db);
    expect(resultado.normalizados.map((a) => a.id)).toEqual(["a-velho", "a-1"]);
    expect(alarmeRepository.inserirAlarmeAberto).not.toHaveBeenCalled();
  });
});
