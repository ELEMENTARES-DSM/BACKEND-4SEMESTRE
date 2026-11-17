import * as sensorRepository from "../../repositories/sensor.repository";
import * as estacaoRepository from "../../repositories/estacao.repository";
import * as sensorService from "../../services/sensor.service";
import { Estacao } from "../../models/estacao.model";
import { SensorDetectado } from "../../models/sensor.model";

jest.mock("../../repositories/sensor.repository", () => ({
  findDetectados: jest.fn(),
}));
jest.mock("../../repositories/estacao.repository", () => ({
  findById: jest.fn(),
}));

const sensores = jest.mocked(sensorRepository);
const estacoes = jest.mocked(estacaoRepository);

const ESTACAO_ID = "11111111-1111-4111-8111-111111111111";
const estacao = { id: ESTACAO_ID, municipio: "São José dos Campos" } as Estacao;
const gestor = { papel: "GESTOR_PUBLICO", municipio: "São José dos Campos" };
const gestorDeOutroMunicipio = { papel: "GESTOR_PUBLICO", municipio: "Jacareí" };
const admin = { papel: "ADMINISTRADOR", municipio: "Jacareí" };

const detectados: SensorDetectado[] = [
  { codigo: "PM25", total: 12, ultimo_valor: 12, ultima_leitura_em: "2026-11-17T17:20:00.000Z" },
  { codigo: "PM10", total: 12, ultimo_valor: 20, ultima_leitura_em: "2026-11-17T17:20:00.000Z" },
];

describe("sensor.service: códigos detectados (US-39)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    estacoes.findById.mockResolvedValue(estacao);
    sensores.findDetectados.mockResolvedValue(detectados);
  });

  it("deve devolver os códigos que a estação mandou e ainda não têm sensor", async () => {
    // Quando
    const resultado = await sensorService.listarDetectados(ESTACAO_ID, gestor);

    // Então
    expect(resultado).toEqual(detectados);
  });

  it("deve pedir só os últimos 7 dias e no máximo 50 códigos", async () => {
    // Quando
    await sensorService.listarDetectados(ESTACAO_ID, gestor);

    // Então
    expect(sensorService.DIAS_DETECCAO).toBe(7);
    expect(sensorService.LIMITE_DETECTADOS).toBe(50);
    expect(sensores.findDetectados).toHaveBeenCalledWith(ESTACAO_ID, 7, 50);
  });

  it("deve responder 404 e não consultar o staging quando a estação não existe", async () => {
    // Dado
    estacoes.findById.mockResolvedValue(null);

    // Quando
    const promessa = sensorService.listarDetectados(ESTACAO_ID, gestor);

    // Então
    await expect(promessa).rejects.toMatchObject({ statusCode: 404 });
    expect(sensores.findDetectados).not.toHaveBeenCalled();
  });

  it("deve responder 403 quando o gestor é de outro município", async () => {
    // Quando
    const promessa = sensorService.listarDetectados(ESTACAO_ID, gestorDeOutroMunicipio);

    // Então
    await expect(promessa).rejects.toMatchObject({ statusCode: 403 });
    expect(sensores.findDetectados).not.toHaveBeenCalled();
  });

  it("deve deixar o ADMINISTRADOR ver estação de qualquer município", async () => {
    // Quando
    const resultado = await sensorService.listarDetectados(ESTACAO_ID, admin);

    // Então
    expect(resultado).toEqual(detectados);
  });

  it("deve devolver lista vazia quando a estação não mandou nenhum código novo", async () => {
    // Dado
    sensores.findDetectados.mockResolvedValue([]);

    // Quando / Então
    await expect(sensorService.listarDetectados(ESTACAO_ID, gestor)).resolves.toEqual([]);
  });
});
