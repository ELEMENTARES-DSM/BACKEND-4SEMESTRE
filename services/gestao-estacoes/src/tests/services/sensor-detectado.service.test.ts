import * as sensorRepository from "../../repositories/sensor.repository";
import * as estacaoRepository from "../../repositories/estacao.repository";
import * as stagingValkey from "../../repositories/staging-valkey.repository";
import * as sensorService from "../../services/sensor.service";
import { Estacao } from "../../models/estacao.model";

jest.mock("../../repositories/sensor.repository", () => ({
  findCodigosDaEstacao: jest.fn(),
}));
jest.mock("../../repositories/estacao.repository", () => ({
  findById: jest.fn(),
}));
jest.mock("../../repositories/staging-valkey.repository", () => ({
  listarMensagensVerificadas: jest.fn(),
}));

const sensores = jest.mocked(sensorRepository);
const estacoes = jest.mocked(estacaoRepository);
const staging = jest.mocked(stagingValkey);

const ESTACAO_ID = "11111111-1111-4111-8111-111111111111";
const MAC_ESTACAO = "aabbccdd0001";
const estacao = { id: ESTACAO_ID, mac_address: MAC_ESTACAO, municipio: "São José dos Campos" } as Estacao;
const gestor = { papel: "GESTOR_PUBLICO", municipio: "São José dos Campos" };
const gestorDeOutroMunicipio = { papel: "GESTOR_PUBLICO", municipio: "Jacareí" };
const admin = { papel: "ADMINISTRADOR", municipio: "Jacareí" };

const AGORA = new Date("2026-11-17T18:00:00.000Z");
const agora = () => AGORA;

const mensagem = (timestamp: string, leituras: unknown[]) => ({
  payloadBruto: JSON.stringify({ timestamp, leituras }),
  recebidoEm: timestamp,
});

const recente = mensagem("2026-11-17T17:20:00.000Z", [
  { sensor: "PM25", valor: 12 },
  { sensor: "PM10", valor: 20 },
]);

describe("sensor.service: códigos detectados no staging do Valkey (US-39)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    estacoes.findById.mockResolvedValue(estacao);
    staging.listarMensagensVerificadas.mockResolvedValue([recente]);
    sensores.findCodigosDaEstacao.mockResolvedValue([]);
  });

  it("deve devolver os códigos que a estação mandou, com total, último valor e horário", async () => {
    // Quando
    const resultado = await sensorService.listarDetectados(ESTACAO_ID, gestor, agora);

    // Então
    expect(resultado).toEqual([
      { codigo: "PM10", total: 1, ultimo_valor: 20, ultima_leitura_em: "2026-11-17T17:20:00.000Z" },
      { codigo: "PM25", total: 1, ultimo_valor: 12, ultima_leitura_em: "2026-11-17T17:20:00.000Z" },
    ]);
  });

  it("deve pedir ao Valkey só as mensagens da estação consultada", async () => {
    // Quando
    await sensorService.listarDetectados(ESTACAO_ID, gestor, agora);

    // Então
    expect(staging.listarMensagensVerificadas).toHaveBeenCalledWith(MAC_ESTACAO);
    expect(sensores.findCodigosDaEstacao).toHaveBeenCalledWith(ESTACAO_ID);
  });

  it("deve tirar os códigos que a estação já tem cadastrados, ativos ou inativos", async () => {
    // Dado
    sensores.findCodigosDaEstacao.mockResolvedValue(["PM10"]);

    // Quando
    const resultado = await sensorService.listarDetectados(ESTACAO_ID, gestor, agora);

    // Então
    expect(resultado.map((d) => d.codigo)).toEqual(["PM25"]);
  });

  it("deve olhar só os últimos 7 dias", async () => {
    // Dado
    staging.listarMensagensVerificadas.mockResolvedValue([
      mensagem("2026-11-10T17:59:59.000Z", [{ sensor: "ANTIGO", valor: 1 }]),
      mensagem("2026-11-10T18:00:00.000Z", [{ sensor: "NO-LIMITE", valor: 1 }]),
    ]);

    // Quando
    const resultado = await sensorService.listarDetectados(ESTACAO_ID, gestor, agora);

    // Então
    expect(sensorService.DIAS_DETECCAO).toBe(7);
    expect(resultado.map((d) => d.codigo)).toEqual(["NO-LIMITE"]);
  });

  it("deve devolver no máximo 50 códigos, os mais recentes primeiro", async () => {
    // Dado
    const leituras = Array.from({ length: 60 }, (_, i) => ({ sensor: `S-${String(i).padStart(2, "0")}`, valor: i }));
    staging.listarMensagensVerificadas.mockResolvedValue([mensagem("2026-11-17T17:00:00.000Z", leituras)]);

    // Quando
    const resultado = await sensorService.listarDetectados(ESTACAO_ID, gestor, agora);

    // Então
    expect(sensorService.LIMITE_DETECTADOS).toBe(50);
    expect(resultado).toHaveLength(50);
  });

  it("deve responder 404 e não consultar o Valkey quando a estação não existe", async () => {
    // Dado
    estacoes.findById.mockResolvedValue(null);

    // Quando
    const promessa = sensorService.listarDetectados(ESTACAO_ID, gestor, agora);

    // Então
    await expect(promessa).rejects.toMatchObject({ statusCode: 404 });
    expect(staging.listarMensagensVerificadas).not.toHaveBeenCalled();
  });

  it("deve responder 403 quando o gestor é de outro município", async () => {
    // Quando
    const promessa = sensorService.listarDetectados(ESTACAO_ID, gestorDeOutroMunicipio, agora);

    // Então
    await expect(promessa).rejects.toMatchObject({ statusCode: 403 });
    expect(staging.listarMensagensVerificadas).not.toHaveBeenCalled();
  });

  it("deve deixar o ADMINISTRADOR ver estação de qualquer município", async () => {
    // Quando
    const resultado = await sensorService.listarDetectados(ESTACAO_ID, admin, agora);

    // Então
    expect(resultado).toHaveLength(2);
  });

  it("deve devolver lista vazia quando a estação não mandou nenhum código novo", async () => {
    // Dado
    staging.listarMensagensVerificadas.mockResolvedValue([]);

    // Quando / Então
    await expect(sensorService.listarDetectados(ESTACAO_ID, gestor, agora)).resolves.toEqual([]);
  });

  it("deve responder 503 com aviso claro quando o Valkey está fora", async () => {
    // Dado
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    staging.listarMensagensVerificadas.mockRejectedValue(new Error("The client is closed"));

    // Quando
    const promessa = sensorService.listarDetectados(ESTACAO_ID, gestor, agora);

    // Então
    await expect(promessa).rejects.toMatchObject({
      statusCode: 503,
      message: expect.stringContaining("códigos recebidos"),
    });
  });

  it("deve deixar o erro do PostgreSQL subir como está (não é problema do Valkey)", async () => {
    // Dado
    const erro = new Error("conexão perdida");
    sensores.findCodigosDaEstacao.mockRejectedValue(erro);

    // Quando / Então
    await expect(sensorService.listarDetectados(ESTACAO_ID, gestor, agora)).rejects.toBe(erro);
  });
});
