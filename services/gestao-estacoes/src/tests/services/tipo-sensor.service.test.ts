import * as tipoSensorRepository from "../../repositories/tipo-sensor.repository";
import { criar, listar, obterPorNome } from "../../services/tipo-sensor.service";
import { CreateTipoSensorDTO } from "../../dto/create-tipo-sensor.dto";
import { TipoSensorCatalogo } from "../../models/tipo-sensor.model";
import { AppError } from "../../middlewares/error-handler";

jest.mock("../../repositories/tipo-sensor.repository", () => ({
  findAll: jest.fn(),
  findByNome: jest.fn(),
  create: jest.fn(),
}));

const repo = jest.mocked(tipoSensorRepository);

const dadosValidos: CreateTipoSensorDTO = {
  nome: "Nebulosidade",
  unidade: "%",
  faixa_min: 0,
  faixa_max: 100,
  agregacao: "media",
};

const grandezaCriada: TipoSensorCatalogo = {
  id: "5549e54b-346e-4a87-8f7d-d2604c878530",
  nome: "Nebulosidade",
  unidade: "%",
  faixa_min: "0.00",
  faixa_max: "100.00",
  agregacao: "media",
};

describe("tipo-sensor.service (US-39)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repo.findByNome.mockResolvedValue(null);
    repo.create.mockResolvedValue(grandezaCriada);
  });

  describe("listar", () => {
    it("deve devolver as grandezas do catálogo quando o repository retorna linhas", async () => {
      // Dado
      repo.findAll.mockResolvedValue([grandezaCriada]);

      // Quando
      const resultado = await listar();

      // Então
      expect(resultado).toEqual([grandezaCriada]);
    });
  });

  describe("obterPorNome", () => {
    it("deve devolver a grandeza quando o nome existe no catálogo", async () => {
      // Dado
      repo.findByNome.mockResolvedValue(grandezaCriada);

      // Quando
      const resultado = await obterPorNome("Nebulosidade");

      // Então
      expect(repo.findByNome).toHaveBeenCalledWith("Nebulosidade");
      expect(resultado).toBe(grandezaCriada);
    });

    it("deve responder 400 com o nome pedido quando a grandeza não existe", async () => {
      // Dado
      repo.findByNome.mockResolvedValue(null);

      // Quando
      const promessa = obterPorNome("Radiação Solar");

      // Então
      await expect(promessa).rejects.toMatchObject({
        statusCode: 400,
        message: 'Tipo de sensor "Radiação Solar" não existe no catálogo de grandezas.',
      });
    });
  });

  describe("criar", () => {
    it("deve gravar a grandeza e devolver a linha criada quando os dados são válidos", async () => {
      // Dado
      const dados = { ...dadosValidos };

      // Quando
      const resultado = await criar(dados);

      // Então
      expect(repo.create).toHaveBeenCalledWith(dados);
      expect(resultado).toEqual(grandezaCriada);
    });

    it("deve responder 400 quando faixa_min é igual a faixa_max", async () => {
      // Dado
      const dados = { ...dadosValidos, faixa_min: 10, faixa_max: 10 };

      // Quando
      const promessa = criar(dados);

      // Então
      await expect(promessa).rejects.toMatchObject({ statusCode: 400 });
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("deve responder 400 quando faixa_min é maior que faixa_max", async () => {
      // Dado
      const dados = { ...dadosValidos, faixa_min: 100, faixa_max: 0 };

      // Quando
      const promessa = criar(dados);

      // Então
      await expect(promessa).rejects.toBeInstanceOf(AppError);
      await expect(promessa).rejects.toMatchObject({ statusCode: 400 });
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("deve aceitar quando faixa_max é só 0,01 maior que faixa_min", async () => {
      // Dado
      const dados = { ...dadosValidos, faixa_min: 0, faixa_max: 0.01 };

      // Quando
      await criar(dados);

      // Então
      expect(repo.create).toHaveBeenCalledWith(dados);
    });

    it("deve responder 409 quando já existe uma grandeza com o mesmo nome", async () => {
      // Dado
      repo.findByNome.mockResolvedValue(grandezaCriada);

      // Quando
      const promessa = criar({ ...dadosValidos });

      // Então
      await expect(promessa).rejects.toMatchObject({
        statusCode: 409,
        message: 'Já existe uma grandeza com o nome "Nebulosidade" no catálogo.',
      });
      expect(repo.create).not.toHaveBeenCalled();
    });
  });
});
