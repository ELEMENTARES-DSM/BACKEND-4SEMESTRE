import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import * as tipoSensorRepository from "../../repositories/tipo-sensor.repository";
import * as estacaoRepository from "../../repositories/estacao.repository";
import { TipoSensorCatalogo } from "../../models/tipo-sensor.model";

jest.mock("../../repositories/tipo-sensor.repository", () => ({
  findAll: jest.fn(),
  findByNome: jest.fn(),
  create: jest.fn(),
}));
jest.mock("../../repositories/estacao.repository", () => ({
  findById: jest.fn(),
}));

const SEGREDO = "segredo-teste-tipos-sensor";
const repo = jest.mocked(tipoSensorRepository);
const estacaoRepo = jest.mocked(estacaoRepository);

const tokenDe = (papel: string) =>
  jwt.sign({ id: "u1", papel, municipio: "São José dos Campos" }, SEGREDO);

const payloadValido = {
  nome: "Nebulosidade",
  unidade: "%",
  faixa_min: 0,
  faixa_max: 100,
};

const direcaoDoVento: TipoSensorCatalogo = {
  id: "1",
  nome: "Direção do Vento",
  unidade: "°",
  faixa_min: "0.00",
  faixa_max: "360.00",
  agregacao: "media_circular",
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
  repo.findAll.mockResolvedValue([direcaoDoVento]);
  repo.findByNome.mockResolvedValue(null);
  repo.create.mockResolvedValue({
    id: "2",
    ...payloadValido,
    faixa_min: "0.00",
    faixa_max: "100.00",
    agregacao: "media",
  });
});

describe("tipo-sensor.routes (US-39)", () => {
  describe("GET /estacoes/tipos-sensor", () => {
    it("deve responder 401 quando não há token", async () => {
      // Quando
      const res = await request(app).get("/estacoes/tipos-sensor");

      // Então
      expect(res.status).toBe(401);
    });

    it("deve listar o catálogo sem cair em GET /estacoes/:id quando o usuário é GESTOR_PUBLICO", async () => {
      // Dado
      const token = tokenDe("GESTOR_PUBLICO");

      // Quando
      const res = await request(app)
        .get("/estacoes/tipos-sensor")
        .set("Authorization", `Bearer ${token}`);

      // Então
      expect(res.status).toBe(200);
      expect(res.body).toEqual([direcaoDoVento]);
      expect(estacaoRepo.findById).not.toHaveBeenCalled();
    });

    it("deve listar o catálogo quando o usuário é PESQUISADOR", async () => {
      // Dado
      const token = tokenDe("PESQUISADOR");

      // Quando
      const res = await request(app)
        .get("/estacoes/tipos-sensor")
        .set("Authorization", `Bearer ${token}`);

      // Então
      expect(res.status).toBe(200);
    });
  });

  describe("POST /estacoes/tipos-sensor", () => {
    const postar = (papel: string, corpo: unknown) =>
      request(app)
        .post("/estacoes/tipos-sensor")
        .set("Authorization", `Bearer ${tokenDe(papel)}`)
        .send(corpo as object);

    it("deve responder 401 quando não há token", async () => {
      // Quando
      const res = await request(app).post("/estacoes/tipos-sensor").send(payloadValido);

      // Então
      expect(res.status).toBe(401);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it.each(["GESTOR_PUBLICO", "PESQUISADOR"])(
      "deve responder 403 e não gravar quando o perfil é %s",
      async (papel) => {
        // Quando
        const res = await postar(papel, payloadValido);

        // Então
        expect(res.status).toBe(403);
        expect(repo.create).not.toHaveBeenCalled();
      }
    );

    it("deve responder 201 com a agregação padrão 'media' quando o ADMINISTRADOR omite a agregação", async () => {
      // Quando
      const res = await postar("ADMINISTRADOR", payloadValido);

      // Então
      expect(res.status).toBe(201);
      expect(repo.create).toHaveBeenCalledWith({ ...payloadValido, agregacao: "media" });
      expect(res.body).toMatchObject({ nome: "Nebulosidade", agregacao: "media" });
    });

    it("deve gravar a agregação informada quando o ADMINISTRADOR cadastra uma grandeza de soma", async () => {
      // Dado
      const corpo = { ...payloadValido, nome: "Chuva acumulada", unidade: "mm", agregacao: "soma" };

      // Quando
      const res = await postar("ADMINISTRADOR", corpo);

      // Então
      expect(res.status).toBe(201);
      expect(repo.create).toHaveBeenCalledWith(corpo);
    });

    it("deve responder 400 quando faixa_min é igual a faixa_max", async () => {
      // Quando
      const res = await postar("ADMINISTRADOR", { ...payloadValido, faixa_min: 50, faixa_max: 50 });

      // Então
      expect(res.status).toBe(400);
      expect(res.body.message).toBe("faixa_min deve ser menor que faixa_max.");
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("deve responder 400 quando faixa_min é maior que faixa_max", async () => {
      // Quando
      const res = await postar("ADMINISTRADOR", { ...payloadValido, faixa_min: 100, faixa_max: 0 });

      // Então
      expect(res.status).toBe(400);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("deve responder 400 quando a agregação é inválida", async () => {
      // Quando
      const res = await postar("ADMINISTRADOR", { ...payloadValido, agregacao: "mediana" });

      // Então
      expect(res.status).toBe(400);
      expect(res.body.errors).toHaveProperty("agregacao");
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("deve responder 400 quando o corpo está vazio", async () => {
      // Quando
      const res = await postar("ADMINISTRADOR", {});

      // Então
      expect(res.status).toBe(400);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("deve responder 409 quando o nome já existe no catálogo", async () => {
      // Dado
      repo.findByNome.mockResolvedValue(direcaoDoVento);

      // Quando
      const res = await postar("ADMINISTRADOR", { ...payloadValido, nome: "Direção do Vento" });

      // Então
      expect(res.status).toBe(409);
      expect(res.body.message).toBe('Já existe uma grandeza com o nome "Direção do Vento" no catálogo.');
      expect(repo.create).not.toHaveBeenCalled();
    });
  });
});
