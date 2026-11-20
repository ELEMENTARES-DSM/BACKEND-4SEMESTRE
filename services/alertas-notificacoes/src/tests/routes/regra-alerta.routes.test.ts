import { subir } from "../helpers/servidor-teste";
import app from "../../app";
import * as regraAlertaRepository from "../../repositories/regra-alerta.repository";
import { SensorComEstacao } from "../../models/regra-alerta.model";

jest.mock("../../repositories/regra-alerta.repository");

const repo = jest.mocked(regraAlertaRepository);

const SENSOR_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const gestor = { papel: "GESTOR_PUBLICO" as const, municipio: "São José dos Campos" };

const temperatura: SensorComEstacao = {
  id: SENSOR_ID,
  tipo: "Temperatura",
  unidade_medida: "°C",
  status: "Ativo",
  estacao_id: "9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  municipio: "São José dos Campos",
  faixa_min: "-50.00",
  faixa_max: "60.00",
};

const corpo = (valorLimite: number) => ({
  sensor_id: SENSOR_ID,
  nome: "Calor extremo",
  operador: ">=",
  valor_limite: valorLimite,
  severidade: "CRITICO",
});

describe("POST /alertas/regras-alerta: limite contra a faixa do catálogo (US-39)", () => {
  let api: Awaited<ReturnType<typeof subir>>;

  beforeAll(async () => {
    api = await subir(app);
  });

  afterAll(async () => {
    await api.fechar();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    repo.findSensorComEstacao.mockResolvedValue(temperatura);
    repo.create.mockImplementation(async (dados) => ({
      id: "7b1e2c3d-4f5a-4b6c-8d7e-9f0a1b2c3d4e",
      sensor_id: dados.sensorId,
      nome: dados.nome,
      operador: dados.operador,
      valor_limite: dados.valorLimite,
      severidade: dados.severidade,
      esta_ativo: true,
      criado_em: "2026-11-17T12:00:00.000Z",
    }));
  });

  it("responde 400, e não 422, quando o limite passa da faixa da grandeza", async () => {
    // Quando
    const { status, corpo: resposta } = await api.post("/alertas/regras-alerta", corpo(60.01), gestor);

    // Então
    expect(status).toBe(400);
    expect(resposta.message).toBe("O valor limite para sensores de Temperatura deve estar entre -50 e 60 °C.");
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("responde 400 quando o limite fica abaixo da faixa", async () => {
    // Quando
    const { status } = await api.post("/alertas/regras-alerta", corpo(-50.01), gestor);

    // Então
    expect(status).toBe(400);
  });

  it("responde 201 quando o limite está exatamente na borda da faixa", async () => {
    // Quando
    const alto = await api.post("/alertas/regras-alerta", corpo(60), gestor);
    const baixo = await api.post("/alertas/regras-alerta", corpo(-50), gestor);

    // Então
    expect(alto.status).toBe(201);
    expect(baixo.status).toBe(201);
    expect(repo.create).toHaveBeenCalledTimes(2);
  });

  it("segue respondendo 422 quando o sensor está inativo", async () => {
    // Dado
    repo.findSensorComEstacao.mockResolvedValue({ ...temperatura, status: "Inativo" });

    // Quando
    const { status } = await api.post("/alertas/regras-alerta", corpo(30), gestor);

    // Então
    expect(status).toBe(422);
  });
});
