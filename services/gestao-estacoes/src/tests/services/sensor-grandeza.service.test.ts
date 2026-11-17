import * as sensorRepository from "../../repositories/sensor.repository";
import * as estacaoRepository from "../../repositories/estacao.repository";
import * as tipoSensorRepository from "../../repositories/tipo-sensor.repository";
import * as sensorService from "../../services/sensor.service";
import { Sensor } from "../../models/sensor.model";
import { TipoSensorCatalogo } from "../../models/tipo-sensor.model";
import { Estacao } from "../../models/estacao.model";

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

const sensores = jest.mocked(sensorRepository);
const estacoes = jest.mocked(estacaoRepository);
const catalogo = jest.mocked(tipoSensorRepository);

const ESTACAO_ID = "11111111-1111-4111-8111-111111111111";
const SENSOR_ID = "22222222-2222-4222-8222-222222222222";

const admin = { papel: "ADMINISTRADOR", municipio: "São José dos Campos" };
const gestorDeOutroMunicipio = { papel: "GESTOR_PUBLICO", municipio: "Jacareí" };

const estacao = { id: ESTACAO_ID, municipio: "São José dos Campos" } as Estacao;

const direcaoDoVento: TipoSensorCatalogo = {
  id: "1",
  nome: "Direção do Vento",
  unidade: "°",
  faixa_min: "0.00",
  faixa_max: "360.00",
  agregacao: "media_circular",
};
const precipitacao: TipoSensorCatalogo = {
  id: "2",
  nome: "Precipitação",
  unidade: "mm",
  faixa_min: "0.00",
  faixa_max: "500.00",
  agregacao: "soma",
};

const sensorSalvo = (tipo: string, unidade: string): Sensor => ({
  id: SENSOR_ID,
  estacao_id: ESTACAO_ID,
  codigo: "DIR-01",
  nome: null,
  tipo,
  unidade_medida: unidade,
  unidade_leitura: null,
  fator: "1.000000",
  ganho: "0.000000",
  status: "Ativo",
  criado_em: "2026-11-17T12:00:00.000Z",
});

describe("sensor.service: grandeza vinda do catálogo (US-39)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    estacoes.findById.mockResolvedValue(estacao);
    sensores.findByEstacaoIdETipo.mockResolvedValue(null);
    catalogo.findByNome.mockImplementation(async (nome) =>
      [direcaoDoVento, precipitacao].find((g) => g.nome === nome) ?? null
    );
  });

  describe("create", () => {
    it("deve gravar o sensor com a unidade da grandeza do catálogo quando o tipo é Direção do Vento", async () => {
      // Dado
      sensores.create.mockResolvedValue(sensorSalvo("Direção do Vento", "°"));

      // Quando
      await sensorService.create(ESTACAO_ID, admin, { codigo: "DIR-01", tipo: "Direção do Vento" });

      // Então
      expect(sensores.create).toHaveBeenCalledWith(
        ESTACAO_ID,
        expect.objectContaining({
          codigo: "DIR-01",
          tipo: "Direção do Vento",
          unidadeMedida: "°",
          fator: 1,
          ganho: 0,
        })
      );
    });

    it("deve ignorar a unidade e usar a do catálogo quando o cliente tenta mandar outra", async () => {
      // Dado
      sensores.create.mockResolvedValue(sensorSalvo("Precipitação", "mm"));
      const entrada = { tipo: "Precipitação", unidade_medida: "polegadas" } as never;

      // Quando
      await sensorService.create(ESTACAO_ID, admin, entrada);

      // Então
      expect(sensores.create).toHaveBeenCalledWith(
        ESTACAO_ID,
        expect.objectContaining({ unidadeMedida: "mm" })
      );
    });

    it("deve responder 400 e não gravar quando a grandeza não existe no catálogo", async () => {
      // Quando
      const promessa = sensorService.create(ESTACAO_ID, admin, { tipo: "Radiação Solar" });

      // Então
      await expect(promessa).rejects.toMatchObject({
        statusCode: 400,
        message: 'Tipo de sensor "Radiação Solar" não existe no catálogo de grandezas.',
      });
      expect(sensores.create).not.toHaveBeenCalled();
    });

    it("deve responder 409 quando a estação já tem sensor da mesma grandeza", async () => {
      // Dado
      sensores.findByEstacaoIdETipo.mockResolvedValue(sensorSalvo("Precipitação", "mm"));

      // Quando
      const promessa = sensorService.create(ESTACAO_ID, admin, { tipo: "Precipitação" });

      // Então
      await expect(promessa).rejects.toMatchObject({ statusCode: 409 });
      expect(sensores.create).not.toHaveBeenCalled();
    });

    it("deve responder 404 e não consultar o catálogo quando a estação não existe", async () => {
      // Dado
      estacoes.findById.mockResolvedValue(null);

      // Quando
      const promessa = sensorService.create(ESTACAO_ID, admin, { tipo: "Precipitação" });

      // Então
      await expect(promessa).rejects.toMatchObject({ statusCode: 404 });
      expect(catalogo.findByNome).not.toHaveBeenCalled();
    });

    it("deve responder 403 quando a estação é de outro município", async () => {
      // Quando
      const promessa = sensorService.create(ESTACAO_ID, gestorDeOutroMunicipio, { tipo: "Precipitação" });

      // Então
      await expect(promessa).rejects.toMatchObject({ statusCode: 403 });
      expect(sensores.create).not.toHaveBeenCalled();
    });
  });

  describe("update", () => {
    beforeEach(() => {
      sensores.findById.mockResolvedValue(sensorSalvo("Precipitação", "mm"));
    });

    it("deve trocar a unidade junto com a grandeza quando o PUT muda o tipo", async () => {
      // Dado
      sensores.update.mockResolvedValue(sensorSalvo("Direção do Vento", "°"));

      // Quando
      await sensorService.update(SENSOR_ID, admin, { tipo: "Direção do Vento", fator: 2 });

      // Então
      expect(sensores.update).toHaveBeenCalledWith(
        SENSOR_ID,
        expect.objectContaining({ tipo: "Direção do Vento", unidadeMedida: "°", fator: 2, ganho: 0 })
      );
    });

    it("deve ignorar o próprio sensor na checagem de duplicidade quando o tipo não muda", async () => {
      // Dado
      sensores.update.mockResolvedValue(sensorSalvo("Precipitação", "mm"));

      // Quando
      await sensorService.update(SENSOR_ID, admin, { tipo: "Precipitação" });

      // Então
      expect(sensores.findByEstacaoIdETipo).toHaveBeenCalledWith(ESTACAO_ID, "Precipitação", SENSOR_ID);
    });

    it("deve responder 400 e não atualizar quando a nova grandeza não existe no catálogo", async () => {
      // Quando
      const promessa = sensorService.update(SENSOR_ID, admin, { tipo: "Radiação Solar" });

      // Então
      await expect(promessa).rejects.toMatchObject({ statusCode: 400 });
      expect(sensores.update).not.toHaveBeenCalled();
    });

    it("deve responder 404 quando o sensor não existe", async () => {
      // Dado
      sensores.findById.mockResolvedValue(null);

      // Quando
      const promessa = sensorService.update(SENSOR_ID, admin, { tipo: "Precipitação" });

      // Então
      await expect(promessa).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe("listByEstacao e updateStatus", () => {
    it("deve listar os sensores da estação quando o usuário tem acesso", async () => {
      // Dado
      const lista = [sensorSalvo("Precipitação", "mm")];
      sensores.findByEstacaoId.mockResolvedValue(lista);

      // Quando
      const resultado = await sensorService.listByEstacao(ESTACAO_ID, admin);

      // Então
      expect(resultado).toEqual(lista);
    });

    it("deve inativar o sensor sem consultar o catálogo quando o usuário tem acesso", async () => {
      // Dado
      sensores.findById.mockResolvedValue(sensorSalvo("Precipitação", "mm"));
      sensores.updateStatus.mockResolvedValue({ ...sensorSalvo("Precipitação", "mm"), status: "Inativo" });

      // Quando
      const resultado = await sensorService.updateStatus(SENSOR_ID, admin, "Inativo");

      // Então
      expect(resultado.status).toBe("Inativo");
      expect(catalogo.findByNome).not.toHaveBeenCalled();
    });

    it("deve responder 404 ao mudar o status de um sensor que não existe", async () => {
      // Dado
      sensores.findById.mockResolvedValue(null);

      // Quando
      const promessa = sensorService.updateStatus(SENSOR_ID, admin, "Inativo");

      // Então
      await expect(promessa).rejects.toMatchObject({ statusCode: 404 });
    });
  });
});
