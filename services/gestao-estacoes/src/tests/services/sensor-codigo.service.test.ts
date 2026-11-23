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

const sensores = jest.mocked(sensorRepository);
const estacoes = jest.mocked(estacaoRepository);
const catalogo = jest.mocked(tipoSensorRepository);

const ESTACAO_ID = "11111111-1111-4111-8111-111111111111";
const SENSOR_ID = "22222222-2222-4222-8222-222222222222";
const admin = { papel: "ADMINISTRADOR", municipio: "São José dos Campos" };

const temperatura: TipoSensorCatalogo = {
  id: "1",
  nome: "Temperatura",
  unidade: "°C",
  faixa_min: "-50.00",
  faixa_max: "60.00",
  agregacao: "media",
};

const sensorComCodigo = (codigo: string | null): Sensor => ({
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

describe("sensor.service: código único por estação (US-39)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    estacoes.findById.mockResolvedValue({ id: ESTACAO_ID, municipio: "São José dos Campos" } as Estacao);
    catalogo.findByNome.mockResolvedValue(temperatura);
    sensores.findByEstacaoIdETipo.mockResolvedValue(null);
    sensores.findByEstacaoIdECodigo.mockResolvedValue(null);
    sensores.create.mockResolvedValue(sensorComCodigo("TEMP-01"));
    sensores.update.mockResolvedValue(sensorComCodigo("TEMP-01"));
  });

  describe("create", () => {
    it("deve conferir o código na estação e gravar quando ele está livre", async () => {
      // Quando
      await sensorService.create(ESTACAO_ID, admin, { codigo: "TEMP-01", tipo: "Temperatura" });

      // Então
      expect(sensores.findByEstacaoIdECodigo).toHaveBeenCalledWith(ESTACAO_ID, "TEMP-01", undefined);
      expect(sensores.create).toHaveBeenCalledWith(
        ESTACAO_ID,
        expect.objectContaining({ codigo: "TEMP-01" })
      );
    });

    it("deve responder 409 com a mensagem do código e não gravar quando a estação já usa o código", async () => {
      // Dado
      sensores.findByEstacaoIdECodigo.mockResolvedValue(sensorComCodigo("TEMP-01"));

      // Quando
      const promessa = sensorService.create(ESTACAO_ID, admin, { codigo: "TEMP-01", tipo: "Temperatura" });

      // Então
      await expect(promessa).rejects.toMatchObject({
        statusCode: 409,
        message: 'Já existe um sensor com o código "TEMP-01" nesta estação.',
      });
      expect(sensores.create).not.toHaveBeenCalled();
    });
  });

  describe("update", () => {
    it("deve manter o código e não consultar duplicidade quando o PUT não informa código", async () => {
      // Dado
      sensores.findById.mockResolvedValue(sensorComCodigo("TEMP-01"));

      // Quando
      await sensorService.update(SENSOR_ID, admin, { tipo: "Temperatura" });

      // Então
      expect(sensores.findByEstacaoIdECodigo).not.toHaveBeenCalled();
      expect(sensores.update).toHaveBeenCalledWith(
        SENSOR_ID,
        expect.objectContaining({ codigo: undefined })
      );
    });

    it("deve aceitar o PUT que repete o código atual sem consultar duplicidade", async () => {
      // Dado
      sensores.findById.mockResolvedValue(sensorComCodigo("TEMP-01"));

      // Quando
      await sensorService.update(SENSOR_ID, admin, { tipo: "Temperatura", codigo: "TEMP-01" });

      // Então
      expect(sensores.findByEstacaoIdECodigo).not.toHaveBeenCalled();
      expect(sensores.update).toHaveBeenCalled();
    });

    it("deve responder 409 e não atualizar quando o PUT tenta trocar um código já definido", async () => {
      // Dado
      sensores.findById.mockResolvedValue(sensorComCodigo("TEMP-01"));

      // Quando
      const promessa = sensorService.update(SENSOR_ID, admin, { tipo: "Temperatura", codigo: "TEMP-02" });

      // Então
      await expect(promessa).rejects.toMatchObject({
        statusCode: 409,
        message: "O código do sensor não pode ser alterado depois de definido.",
      });
      expect(sensores.update).not.toHaveBeenCalled();
    });

    it("deve definir o código de um sensor antigo que não tinha, conferindo duplicidade fora dele mesmo", async () => {
      // Dado
      sensores.findById.mockResolvedValue(sensorComCodigo(null));

      // Quando
      await sensorService.update(SENSOR_ID, admin, { tipo: "Temperatura", codigo: "TEMP-01" });

      // Então
      expect(sensores.findByEstacaoIdECodigo).toHaveBeenCalledWith(ESTACAO_ID, "TEMP-01", SENSOR_ID);
      expect(sensores.update).toHaveBeenCalledWith(
        SENSOR_ID,
        expect.objectContaining({ codigo: "TEMP-01" })
      );
    });

    it("deve responder 409 quando o código escolhido para o sensor antigo já é de outro sensor da estação", async () => {
      // Dado
      sensores.findById.mockResolvedValue(sensorComCodigo(null));
      sensores.findByEstacaoIdECodigo.mockResolvedValue({ ...sensorComCodigo("TEMP-01"), id: "outro" });

      // Quando
      const promessa = sensorService.update(SENSOR_ID, admin, { tipo: "Temperatura", codigo: "TEMP-01" });

      // Então
      await expect(promessa).rejects.toMatchObject({ statusCode: 409 });
      expect(sensores.update).not.toHaveBeenCalled();
    });

    it("deve seguir sem código quando o sensor antigo continua sem código e o PUT não informa", async () => {
      // Dado
      sensores.findById.mockResolvedValue(sensorComCodigo(null));

      // Quando
      await sensorService.update(SENSOR_ID, admin, { tipo: "Temperatura" });

      // Então
      expect(sensores.update).toHaveBeenCalledWith(
        SENSOR_ID,
        expect.objectContaining({ codigo: undefined })
      );
    });
  });
});
