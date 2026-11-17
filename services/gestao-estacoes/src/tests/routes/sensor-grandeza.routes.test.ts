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

const SEGREDO = "segredo-teste-sensor-grandeza";
const ESTACAO_ID = "11111111-1111-4111-8111-111111111111";
const SENSOR_ID = "22222222-2222-4222-8222-222222222222";

const sensores = jest.mocked(sensorRepository);
const estacoes = jest.mocked(estacaoRepository);
const catalogo = jest.mocked(tipoSensorRepository);

const tokenDe = (papel: string) =>
  jwt.sign({ id: "u1", papel, municipio: "São José dos Campos" }, SEGREDO);

const direcaoDoVento: TipoSensorCatalogo = {
  id: "1",
  nome: "Direção do Vento",
  unidade: "°",
  faixa_min: "0.00",
  faixa_max: "360.00",
  agregacao: "media_circular",
};

const sensorSalvo: Sensor = {
  id: SENSOR_ID,
  estacao_id: ESTACAO_ID,
  codigo: "DIR-01",
  nome: null,
  tipo: "Direção do Vento",
  unidade_medida: "°",
  unidade_leitura: null,
  fator_conversao: "1.000000",
  offset: "0.000000",
  status: "Ativo",
  criado_em: "2026-11-17T12:00:00.000Z",
};

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
  catalogo.findByNome.mockImplementation(async (nome) => (nome === "Direção do Vento" ? direcaoDoVento : null));
  sensores.findByEstacaoIdETipo.mockResolvedValue(null);
  sensores.findByEstacaoIdECodigo.mockResolvedValue(null);
  sensores.create.mockResolvedValue(sensorSalvo);
  sensores.findById.mockResolvedValue(sensorSalvo);
  sensores.update.mockResolvedValue(sensorSalvo);
});

describe("sensor.routes: grandeza do catálogo (US-39)", () => {
  // O caminho real é /estacoes/estacoes/:id/sensores (o router declara
  // /estacoes/:estacaoId/sensores e é montado em /estacoes); é o que o front chama.
  const cadastrar = (corpo: object, papel = "GESTOR_PUBLICO") =>
    request(app)
      .post(`/estacoes/estacoes/${ESTACAO_ID}/sensores`)
      .set("Authorization", `Bearer ${tokenDe(papel)}`)
      .send(corpo);

  it("deve responder 201 com a unidade do catálogo quando o sensor é de Direção do Vento (grandeza fora da lista antiga)", async () => {
    // Quando
    const res = await cadastrar({ codigo: "DIR-01", tipo: "Direção do Vento" });

    // Então
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ tipo: "Direção do Vento", unidade_medida: "°" });
    expect(sensores.create).toHaveBeenCalledWith(
      ESTACAO_ID,
      expect.objectContaining({ tipo: "Direção do Vento", unidadeMedida: "°" })
    );
  });

  it("deve responder 400 com mensagem clara quando a grandeza não existe no catálogo", async () => {
    // Quando
    const res = await cadastrar({ codigo: "RAD-01", tipo: "Radiação Solar" });

    // Então
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Tipo de sensor "Radiação Solar" não existe no catálogo de grandezas.');
    expect(sensores.create).not.toHaveBeenCalled();
  });

  it("deve responder 400 quando o tipo não é enviado", async () => {
    // Quando
    const res = await cadastrar({ codigo: "DIR-01" });

    // Então
    expect(res.status).toBe(400);
    expect(sensores.create).not.toHaveBeenCalled();
  });

  it("deve responder 403 quando o perfil não pode cadastrar sensor", async () => {
    // Quando
    const res = await cadastrar({ tipo: "Direção do Vento" }, "PESQUISADOR");

    // Então
    expect(res.status).toBe(403);
    expect(sensores.create).not.toHaveBeenCalled();
  });

  it("deve trocar a unidade junto com a grandeza quando o PUT /sensores/:id muda o tipo", async () => {
    // Quando
    const res = await request(app)
      .put(`/estacoes/sensores/${SENSOR_ID}`)
      .set("Authorization", `Bearer ${tokenDe("ADMINISTRADOR")}`)
      .send({ tipo: "Direção do Vento" });

    // Então
    expect(res.status).toBe(200);
    expect(sensores.update).toHaveBeenCalledWith(
      SENSOR_ID,
      expect.objectContaining({ tipo: "Direção do Vento", unidadeMedida: "°" })
    );
  });
});
