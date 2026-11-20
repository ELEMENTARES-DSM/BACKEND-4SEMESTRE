import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import * as tipoSensorRepository from "../../repositories/tipo-sensor.repository";
import { TipoSensorCatalogo } from "../../models/tipo-sensor.model";

jest.mock("../../repositories/tipo-sensor.repository", () => ({
  findAll: jest.fn(),
  findByNome: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
  contarSensoresDaGrandeza: jest.fn(),
}));
jest.mock("../../repositories/estacao.repository", () => ({
  findById: jest.fn(),
}));

const SEGREDO = "segredo-teste-manutencao-tipos-sensor";
const ID = "5549e54b-346e-4a87-8f7d-d2604c878530";
const repo = jest.mocked(tipoSensorRepository);

const tokenDe = (papel: string) =>
  jwt.sign({ id: "u1", papel, municipio: "São José dos Campos" }, SEGREDO);

const temperatura: TipoSensorCatalogo = {
  id: ID,
  nome: "Temperatura",
  unidade: "°C",
  faixa_min: "-50.00",
  faixa_max: "60.00",
  agregacao: "media",
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
  repo.findById.mockResolvedValue(temperatura);
  repo.contarSensoresDaGrandeza.mockResolvedValue(0);
  repo.update.mockImplementation(async (_id, campos) => ({ ...temperatura, ...campos } as never));
  repo.remove.mockResolvedValue(true);
});

describe("tipo-sensor.routes: PUT e DELETE /estacoes/tipos-sensor/:id (US-39)", () => {
  const alterar = (papel: string, corpo: object, id = ID) =>
    request(app)
      .put(`/estacoes/tipos-sensor/${id}`)
      .set("Authorization", `Bearer ${tokenDe(papel)}`)
      .send(corpo);

  const apagar = (papel: string, id = ID) =>
    request(app)
      .delete(`/estacoes/tipos-sensor/${id}`)
      .set("Authorization", `Bearer ${tokenDe(papel)}`);

  describe("PUT", () => {
    it("deve responder 401 quando não há token", async () => {
      // Quando
      const res = await request(app).put(`/estacoes/tipos-sensor/${ID}`).send({ faixa_max: 70 });

      // Então
      expect(res.status).toBe(401);
    });

    it.each(["GESTOR_PUBLICO", "PESQUISADOR"])(
      "deve responder 403 e não gravar quando o perfil é %s",
      async (papel) => {
        // Quando
        const res = await alterar(papel, { faixa_max: 70 });

        // Então
        expect(res.status).toBe(403);
        expect(repo.update).not.toHaveBeenCalled();
      }
    );

    it("deve responder 200 com a grandeza alterada quando o ADMINISTRADOR muda a faixa", async () => {
      // Quando
      const res = await alterar("ADMINISTRADOR", { faixa_max: 70 });

      // Então
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ nome: "Temperatura", faixa_max: 70 });
    });

    it("deve responder 400 apontando o campo nome quando o corpo tenta renomear a grandeza", async () => {
      // Quando
      const res = await alterar("ADMINISTRADOR", { nome: "Outro", unidade: "K" });

      // Então
      expect(res.status).toBe(400);
      expect(res.body.errors.nome).toEqual(["O nome da grandeza não pode ser alterado."]);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it("deve responder 400 quando o corpo está vazio ou o id não é um UUID", async () => {
      expect((await alterar("ADMINISTRADOR", {})).status).toBe(400);
      expect((await alterar("ADMINISTRADOR", { faixa_max: 70 }, "temperatura")).status).toBe(400);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it("deve responder 400 quando a nova faixa fica invertida em relação à gravada", async () => {
      // Quando: faixa_min igual à faixa_max gravada (60)
      const res = await alterar("ADMINISTRADOR", { faixa_min: 60 });

      // Então
      expect(res.status).toBe(400);
      expect(res.body.message).toBe("faixa_min deve ser menor que faixa_max.");
    });

    it("deve responder 404 quando a grandeza não existe", async () => {
      // Dado
      repo.findById.mockResolvedValue(null);

      // Quando
      const res = await alterar("ADMINISTRADOR", { faixa_max: 70 });

      // Então
      expect(res.status).toBe(404);
    });

    it("deve responder 409 quando a unidade é trocada e algum sensor usa a grandeza", async () => {
      // Dado
      repo.update.mockResolvedValue(null);
      repo.contarSensoresDaGrandeza.mockResolvedValue(2);

      // Quando
      const res = await alterar("ADMINISTRADOR", { unidade: "K" });

      // Então
      expect(res.status).toBe(409);
      expect(res.body.message).toContain("usada por 2 sensores");
    });
  });

  describe("DELETE", () => {
    it("deve responder 401 quando não há token", async () => {
      // Quando
      const res = await request(app).delete(`/estacoes/tipos-sensor/${ID}`);

      // Então
      expect(res.status).toBe(401);
    });

    it.each(["GESTOR_PUBLICO", "PESQUISADOR"])(
      "deve responder 403 e não apagar quando o perfil é %s",
      async (papel) => {
        // Quando
        const res = await apagar(papel);

        // Então
        expect(res.status).toBe(403);
        expect(repo.remove).not.toHaveBeenCalled();
      }
    );

    it("deve responder 204 sem corpo quando o ADMINISTRADOR exclui uma grandeza sem sensores", async () => {
      // Quando
      const res = await apagar("ADMINISTRADOR");

      // Então
      expect(res.status).toBe(204);
      expect(res.text).toBe("");
      expect(repo.remove).toHaveBeenCalledWith(ID);
    });

    it("deve responder 409 com a mensagem clara quando algum sensor usa a grandeza (Cenário 8)", async () => {
      // Dado
      repo.contarSensoresDaGrandeza.mockResolvedValue(1);

      // Quando
      const res = await apagar("ADMINISTRADOR");

      // Então
      expect(res.status).toBe(409);
      expect(res.body.message).toBe(
        "Esta grandeza é usada por 1 sensor e não pode ser excluída. " +
          "Sensores com medidas não podem ser removidos; para parar de usá-la, inative os sensores."
      );
      expect(repo.remove).not.toHaveBeenCalled();
    });

    it("deve responder 404 quando a grandeza não existe e 400 quando o id não é UUID", async () => {
      // Dado
      repo.findById.mockResolvedValue(null);

      // Quando / Então
      expect((await apagar("ADMINISTRADOR")).status).toBe(404);
      expect((await apagar("ADMINISTRADOR", "temperatura")).status).toBe(400);
    });
  });
});
