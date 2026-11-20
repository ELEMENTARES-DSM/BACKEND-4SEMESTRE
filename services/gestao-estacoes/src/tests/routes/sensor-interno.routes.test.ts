import express from "express";
import request from "supertest";
import * as sensorRepository from "../../repositories/sensor.repository";
import * as estacaoRepository from "../../repositories/estacao.repository";
import { SensorParaSimulador } from "../../models/sensor.model";
import { Estacoes } from "../../models/estacao.model";

jest.mock("../../repositories/sensor.repository", () => ({
  findParaSimulador: jest.fn(),
}));
jest.mock("../../repositories/estacao.repository", () => ({
  findById: jest.fn(),
}));

const TOKEN = "token-interno-do-teste";
const ESTACAO_UUID = "11111111-1111-4111-8111-111111111111";
const sensores = jest.mocked(sensorRepository);
const estacoes = jest.mocked(estacaoRepository);

const chuva: SensorParaSimulador = {
  codigo: "CHUVA-01",
  tipo: "Precipitação",
  unidade: "mm",
  faixa_min: "0.00",
  faixa_max: "500.00",
  fator_conversao: "1.000000",
  offset: "0.000000",
  status: "Ativo",
};
const temperaturaEmKelvin: SensorParaSimulador = {
  codigo: "TEMP-K",
  tipo: "Temperatura",
  unidade: "°C",
  faixa_min: "-50.00",
  faixa_max: "60.00",
  fator_conversao: "1.000000",
  offset: "-273.150000",
  status: "Ativo",
};

let app: express.Express;

beforeAll(async () => {
  process.env.INTERNAL_TOKEN = TOKEN;
  process.env.JWT_SECRET = "segredo-teste-rota-interna";
  const routes = (await import("../../routes")).default;
  const { errorHandler } = await import("../../middlewares/error-handler");

  app = express();
  app.use(express.json());
  app.use(routes);
  app.use(errorHandler);
});

beforeEach(() => {
  jest.clearAllMocks();
  estacoes.findById.mockResolvedValue({ id: ESTACAO_UUID } as Estacoes);
  sensores.findParaSimulador.mockResolvedValue([chuva, temperaturaEmKelvin]);
});

describe("GET /api/v1/internal/estacoes/:uuid/sensores (US-39)", () => {
  const caminhos = [
    `/api/v1/internal/estacoes/${ESTACAO_UUID}/sensores`,
    `/estacoes/api/v1/internal/estacoes/${ESTACAO_UUID}/sensores`,
  ];

  it.each(caminhos)("deve responder 401 e não consultar o banco quando falta o token interno em %s", async (caminho) => {
    // Quando
    const res = await request(app).get(caminho);

    // Então
    expect(res.status).toBe(401);
    expect(sensores.findParaSimulador).not.toHaveBeenCalled();
  });

  it("deve responder 401 quando o token interno está errado", async () => {
    // Quando
    const res = await request(app).get(caminhos[0]).set("x-internal-token", "outro-token");

    // Então
    expect(res.status).toBe(401);
  });

  it("deve recusar o JWT de usuário: a rota interna só aceita o token interno", async () => {
    // Quando
    const res = await request(app).get(caminhos[0]).set("Authorization", "Bearer qualquer");

    // Então
    expect(res.status).toBe(401);
  });

  it.each(caminhos)("deve devolver os sensores com a faixa do catálogo e a calibração em %s", async (caminho) => {
    // Quando
    const res = await request(app).get(caminho).set("x-internal-token", TOKEN);

    // Então
    expect(res.status).toBe(200);
    expect(res.body).toEqual([chuva, temperaturaEmKelvin]);
    expect(sensores.findParaSimulador).toHaveBeenCalledWith(ESTACAO_UUID);
  });

  it("deve devolver lista vazia quando a estação existe e não tem sensores", async () => {
    // Dado
    sensores.findParaSimulador.mockResolvedValue([]);

    // Quando
    const res = await request(app).get(caminhos[0]).set("x-internal-token", TOKEN);

    // Então
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("deve responder 404 quando a estação não existe", async () => {
    // Dado
    estacoes.findById.mockResolvedValue(null);

    // Quando
    const res = await request(app).get(caminhos[0]).set("x-internal-token", TOKEN);

    // Então
    expect(res.status).toBe(404);
    expect(res.body.message).toBe("Estação não encontrada.");
    expect(sensores.findParaSimulador).not.toHaveBeenCalled();
  });

  it("deve responder 400 quando o uuid não é válido", async () => {
    // Quando
    const res = await request(app)
      .get("/api/v1/internal/estacoes/estacao-1/sensores")
      .set("x-internal-token", TOKEN);

    // Então
    expect(res.status).toBe(400);
    expect(estacoes.findById).not.toHaveBeenCalled();
  });
});
