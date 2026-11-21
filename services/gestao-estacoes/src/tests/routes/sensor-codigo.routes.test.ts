import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import * as sensorRepository from "../../repositories/sensor.repository";
import * as estacaoRepository from "../../repositories/estacao.repository";
import * as tipoSensorRepository from "../../repositories/tipo-sensor.repository";
import { Sensor } from "../../models/sensor.model";
import { TipoSensorCatalogo } from "../../models/tipo-sensor.model";

jest.mock("../../repositories/sensor.repository", () => ({
  create: jest.fn(),
  findByEstacaoId: jest.fn(),
  findById: jest.fn(),
  findByEstacaoIdETipo: jest.fn(),
  findByEstacaoIdECodigo: jest.fn(),
  update: jest.fn(),
  updateStatus: jest.fn(),
}));
jest.mock("../../repositories/estacao.repository", () => ({
  findById: jest.fn(),
}));
jest.mock("../../repositories/tipo-sensor.repository", () => ({
  findAll: jest.fn(),
  findByNome: jest.fn(),
  create: jest.fn(),
}));

const SEGREDO = "segredo-teste-codigo-sensor";
const ESTACAO_ID = "11111111-1111-4111-8111-111111111111";
const SENSOR_ID = "22222222-2222-4222-8222-222222222222";

const sensores = jest.mocked(sensorRepository);
const estacoes = jest.mocked(estacaoRepository);
const catalogo = jest.mocked(tipoSensorRepository);

const token = jwt.sign(
  { id: "u1", papel: "GESTOR_PUBLICO", municipio: "São José dos Campos" },
  SEGREDO
);

const temperatura: TipoSensorCatalogo = {
  id: "1",
  nome: "Temperatura",
  unidade: "°C",
  faixa_min: "-50.00",
  faixa_max: "60.00",
  agregacao: "media",
};

const sensorSalvo = (codigo: string | null): Sensor => ({
  id: SENSOR_ID,
  estacao_id: ESTACAO_ID,
  codigo,
  nome: null,
  tipo: "Temperatura",
  unidade_medida: "°C",
  unidade_leitura: null,
  fator_conversao: "1.000000",
  offset: "0.000000",
  status: "Ativo",
  criado_em: "2026-11-17T12:00:00.000Z",
});

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
  catalogo.findByNome.mockResolvedValue(temperatura);
  sensores.findByEstacaoIdETipo.mockResolvedValue(null);
  sensores.findByEstacaoIdECodigo.mockResolvedValue(null);
  sensores.create.mockResolvedValue(sensorSalvo("TEMP-01"));
  sensores.update.mockResolvedValue(sensorSalvo("TEMP-01"));
});

describe("sensor.routes: código único por estação (US-39)", () => {
  // O caminho real é /estacoes/estacoes/:id/sensores (ver sensor-grandeza.routes.test.ts).
  const cadastrar = (corpo: object) =>
    request(app)
      .post(`/estacoes/estacoes/${ESTACAO_ID}/sensores`)
      .set("Authorization", `Bearer ${token}`)
      .send(corpo);

  const editar = (corpo: object) =>
    request(app)
      .put(`/estacoes/sensores/${SENSOR_ID}`)
      .set("Authorization", `Bearer ${token}`)
      .send(corpo);

  it("deve responder 400 apontando o campo codigo quando o cadastro não informa o código", async () => {
    // Quando
    const res = await cadastrar({ tipo: "Temperatura" });

    // Então
    expect(res.status).toBe(400);
    expect(res.body.errors).toHaveProperty("codigo");
    expect(sensores.create).not.toHaveBeenCalled();
  });

  it("deve responder 409 quando o código já existe na estação (Cenário 6)", async () => {
    // Dado
    sensores.findByEstacaoIdECodigo.mockResolvedValue(sensorSalvo("TEMP-01"));

    // Quando
    const res = await cadastrar({ codigo: "TEMP-01", tipo: "Temperatura" });

    // Então
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Já existe um sensor com o código "TEMP-01" nesta estação.');
    expect(sensores.create).not.toHaveBeenCalled();
  });

  it("deve responder 201 quando o código é novo na estação", async () => {
    // Quando
    const res = await cadastrar({ codigo: "TEMP-01", tipo: "Temperatura" });

    // Então
    expect(res.status).toBe(201);
    expect(res.body.codigo).toBe("TEMP-01");
  });

  it("deve responder 409 quando o PUT tenta trocar o código já definido", async () => {
    // Dado
    sensores.findById.mockResolvedValue(sensorSalvo("TEMP-01"));

    // Quando
    const res = await editar({ tipo: "Temperatura", codigo: "OUTRO-01" });

    // Então
    expect(res.status).toBe(409);
    expect(res.body.message).toBe("O código do sensor não pode ser alterado depois de definido.");
  });

  it("deve definir o código pelo PUT quando o sensor antigo ainda não tem código", async () => {
    // Dado
    sensores.findById.mockResolvedValue(sensorSalvo(null));

    // Quando
    const res = await editar({ tipo: "Temperatura", codigo: "TEMP-01" });

    // Então
    expect(res.status).toBe(200);
    expect(sensores.update).toHaveBeenCalledWith(
      SENSOR_ID,
      expect.objectContaining({ codigo: "TEMP-01" })
    );
  });

  it("deve aceitar o PUT sem o campo codigo quando o sensor já tem código", async () => {
    // Dado
    sensores.findById.mockResolvedValue(sensorSalvo("TEMP-01"));

    // Quando
    const res = await editar({ tipo: "Temperatura" });

    // Então
    expect(res.status).toBe(200);
  });
});
