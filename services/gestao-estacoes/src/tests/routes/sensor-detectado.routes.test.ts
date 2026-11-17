import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import * as sensorRepository from "../../repositories/sensor.repository";
import * as estacaoRepository from "../../repositories/estacao.repository";
import { SensorDetectado } from "../../models/sensor.model";

jest.mock("../../repositories/sensor.repository", () => ({
  findDetectados: jest.fn(),
  findParaSimulador: jest.fn(),
}));
jest.mock("../../repositories/estacao.repository", () => ({
  findById: jest.fn(),
}));

const SEGREDO = "segredo-teste-sensores-detectados";
const ESTACAO_ID = "11111111-1111-4111-8111-111111111111";
const sensores = jest.mocked(sensorRepository);
const estacoes = jest.mocked(estacaoRepository);

const tokenDe = (papel: string, municipio = "São José dos Campos") =>
  jwt.sign({ id: "u1", papel, municipio }, SEGREDO);

const detectados: SensorDetectado[] = [
  { codigo: "PM25", total: 12, ultimo_valor: 12, ultima_leitura_em: "2026-11-17T17:20:00.000Z" },
];

let app: express.Express;

beforeAll(async () => {
  // O middleware lê JWT_SECRET ao carregar o módulo; por isso o import é dinâmico.
  process.env.JWT_SECRET = SEGREDO;
  const routes = (await import("../../routes")).default;
  const { errorHandler } = await import("../../middlewares/error-handler");

  app = express();
  app.use(express.json());
  app.use(routes);
  app.use(errorHandler);
});

beforeEach(() => {
  jest.clearAllMocks();
  estacoes.findById.mockResolvedValue({
    id: ESTACAO_ID, codigo: "EST-001", nome: "Estação", municipio: "São José dos Campos",
  });
  sensores.findDetectados.mockResolvedValue(detectados);
});

describe("GET /estacoes/estacoes/:estacaoId/sensores/detectados (US-39)", () => {
  // O caminho real é /estacoes/estacoes/:id/sensores/... (ver sensor-grandeza.routes.test.ts).
  const listar = (papel?: string, id = ESTACAO_ID, municipio?: string) => {
    const chamada = request(app).get(`/estacoes/estacoes/${id}/sensores/detectados`);
    return papel ? chamada.set("Authorization", `Bearer ${tokenDe(papel, municipio)}`) : chamada;
  };

  it("deve responder 401 quando não há token", async () => {
    // Quando
    const res = await listar();

    // Então
    expect(res.status).toBe(401);
    expect(sensores.findDetectados).not.toHaveBeenCalled();
  });

  it("deve responder 403 para PESQUISADOR, que não cadastra sensor", async () => {
    // Quando
    const res = await listar("PESQUISADOR");

    // Então
    expect(res.status).toBe(403);
    expect(sensores.findDetectados).not.toHaveBeenCalled();
  });

  it.each(["GESTOR_PUBLICO", "ADMINISTRADOR"])("deve responder 200 com os códigos detectados para %s", async (papel) => {
    // Quando
    const res = await listar(papel);

    // Então
    expect(res.status).toBe(200);
    expect(res.body).toEqual(detectados);
    expect(sensores.findDetectados).toHaveBeenCalledWith(ESTACAO_ID, 7, 50);
  });

  it("deve responder 403 quando o gestor é de outro município", async () => {
    // Quando
    const res = await listar("GESTOR_PUBLICO", ESTACAO_ID, "Jacareí");

    // Então
    expect(res.status).toBe(403);
    expect(sensores.findDetectados).not.toHaveBeenCalled();
  });

  it("deve responder 404 quando a estação não existe", async () => {
    // Dado
    estacoes.findById.mockResolvedValue(null);

    // Quando
    const res = await listar("ADMINISTRADOR");

    // Então
    expect(res.status).toBe(404);
  });

  it("deve responder 400 quando o id da estação não é um UUID", async () => {
    // Quando
    const res = await listar("ADMINISTRADOR", "estacao-1");

    // Então
    expect(res.status).toBe(400);
    expect(sensores.findDetectados).not.toHaveBeenCalled();
  });
});
