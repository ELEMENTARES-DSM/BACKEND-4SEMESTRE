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

const SEGREDO = "segredo-teste-unidade-leitura";
const ESTACAO_ID = "11111111-1111-4111-8111-111111111111";
const SENSOR_ID = "22222222-2222-4222-8222-222222222222";

const sensores = jest.mocked(sensorRepository);
const estacoes = jest.mocked(estacaoRepository);
const catalogo = jest.mocked(tipoSensorRepository);

const tokenDe = (papel: string) =>
  jwt.sign({ id: "u1", papel, municipio: "São José dos Campos" }, SEGREDO);

const temperatura: TipoSensorCatalogo = {
  id: "1",
  nome: "Temperatura",
  unidade: "°C",
  faixa_min: "-50.00",
  faixa_max: "60.00",
  agregacao: "media",
};

const baseDoSensor: Sensor = {
  id: SENSOR_ID,
  estacao_id: ESTACAO_ID,
  codigo: "TEMP-01",
  nome: null,
  tipo: "Temperatura",
  unidade_medida: "°C",
  unidade_leitura: null,
  fator: "1.000000",
  ganho: "0.000000",
  status: "Ativo",
  criado_em: "2026-11-17T12:00:00.000Z",
};

// O mock devolve o que o service mandou gravar: assim a resposta da rota
// prova o que foi para o banco, em vez de repetir um valor fixo.
const ecoDoRepository = (_id: string, d: { tipo: string; unidadeMedida: string; unidadeLeitura: string | null; fator: number; ganho: number }): Sensor => ({
  ...baseDoSensor,
  tipo: d.tipo,
  unidade_medida: d.unidadeMedida,
  unidade_leitura: d.unidadeLeitura,
  fator: String(d.fator),
  ganho: String(d.ganho),
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
  sensores.findById.mockResolvedValue(baseDoSensor);
  sensores.create.mockImplementation(async (id, d) => ecoDoRepository(id, d));
  sensores.update.mockImplementation(async (id, d) => ecoDoRepository(id, d));
});

describe("sensor.routes: unidade_leitura (US-39)", () => {
  // O caminho real é /estacoes/estacoes/:id/sensores (ver sensor-grandeza.routes.test.ts).
  const cadastrar = (corpo: object) =>
    request(app)
      .post(`/estacoes/estacoes/${ESTACAO_ID}/sensores`)
      .set("Authorization", `Bearer ${tokenDe("GESTOR_PUBLICO")}`)
      .send(corpo);

  const editar = (corpo: object) =>
    request(app)
      .put(`/estacoes/sensores/${SENSOR_ID}`)
      .set("Authorization", `Bearer ${tokenDe("GESTOR_PUBLICO")}`)
      .send(corpo);

  it("deve devolver a unidade em que a placa envia e a unidade da grandeza quando o sensor é em Kelvin (Cenário 5)", async () => {
    // Dado: sensor em Kelvin, convertido para °C por offset -273,15
    const corpo = { codigo: "TEMP-K", tipo: "Temperatura", unidade_leitura: "K", fator: 1, ganho: -273.15 };

    // Quando
    const res = await cadastrar(corpo);

    // Então
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      unidade_leitura: "K",
      unidade_medida: "°C",
      fator: "1",
      ganho: "-273.15",
    });
    expect(sensores.create).toHaveBeenCalledWith(
      ESTACAO_ID,
      expect.objectContaining({ unidadeLeitura: "K", unidadeMedida: "°C" })
    );
  });

  it("deve gravar unidade_leitura nula quando o cadastro não informa o campo (sensor sem conversão de unidade)", async () => {
    // Quando
    const res = await cadastrar({ codigo: "TEMP-01", tipo: "Temperatura" });

    // Então
    expect(res.status).toBe(201);
    expect(res.body.unidade_leitura).toBeNull();
    expect(res.body.unidade_medida).toBe("°C");
  });

  it("deve aceitar 20 caracteres e responder 400 com 21", async () => {
    // Quando
    const aceita = await cadastrar({ tipo: "Temperatura", unidade_leitura: "u".repeat(20) });
    const recusada = await cadastrar({ tipo: "Temperatura", unidade_leitura: "u".repeat(21) });

    // Então
    expect(aceita.status).toBe(201);
    expect(recusada.status).toBe(400);
    expect(recusada.body.errors).toHaveProperty("unidade_leitura");
    expect(sensores.create).toHaveBeenCalledTimes(1);
  });

  it("deve gravar a nova unidade de leitura quando o PUT a informa", async () => {
    // Quando
    const res = await editar({ tipo: "Temperatura", unidade_leitura: "K", ganho: -273.15 });

    // Então
    expect(res.status).toBe(200);
    expect(res.body.unidade_leitura).toBe("K");
  });

  it("deve voltar a unidade de leitura para vazio quando o PUT omite o campo", async () => {
    // Dado: sensor que estava em Kelvin
    sensores.findById.mockResolvedValue({ ...baseDoSensor, unidade_leitura: "K" });

    // Quando
    const res = await editar({ tipo: "Temperatura" });

    // Então
    expect(res.status).toBe(200);
    expect(res.body.unidade_leitura).toBeNull();
    expect(sensores.update).toHaveBeenCalledWith(
      SENSOR_ID,
      expect.objectContaining({ unidadeLeitura: null })
    );
  });

  it("deve listar o sensor antigo com unidade_leitura nula sem quebrar", async () => {
    // Dado
    sensores.findByEstacaoId.mockResolvedValue([baseDoSensor]);

    // Quando
    const res = await request(app)
      .get(`/estacoes/estacoes/${ESTACAO_ID}/sensores`)
      .set("Authorization", `Bearer ${tokenDe("GESTOR_PUBLICO")}`);

    // Então
    expect(res.status).toBe(200);
    expect(res.body).toEqual([baseDoSensor]);
  });
});
