import * as estacaoRepository from "../../repositories/estacao.repository";
import {
  getStatusPublicoPorMunicipio,
  listarMunicipiosPublico,
} from "../../services/public-estacoes.service";
import { EstacaoComStatusOperacional } from "../../models/estacao.model";

jest.mock("../../repositories/estacao.repository");

const mockedEstacaoRepository = jest.mocked(estacaoRepository);

describe("public-estacoes.service (ELEM-202)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("deve retornar objeto com a lista de municípios quando houver estações cadastradas", async () => {
    // Dado
    mockedEstacaoRepository.findDistinctMunicipios.mockResolvedValue([
      "Jacareí",
      "São José dos Campos",
    ]);

    // Quando
    const resultado = await listarMunicipiosPublico();

    // Então
    expect(mockedEstacaoRepository.findDistinctMunicipios).toHaveBeenCalledTimes(
      1,
    );
    expect(resultado).toEqual({
      municipios: ["Jacareí", "São José dos Campos"],
    });
  });

  it("deve retornar objeto com lista vazia quando não houver municípios cadastrados", async () => {
    // Dado
    mockedEstacaoRepository.findDistinctMunicipios.mockResolvedValue([]);

    // Quando
    const resultado = await listarMunicipiosPublico();

    // Então
    expect(mockedEstacaoRepository.findDistinctMunicipios).toHaveBeenCalledTimes(
      1,
    );
    expect(resultado).toEqual({
      municipios: [],
    });
  });

  it("deve contabilizar ativas, com_falha e inativas fechando com o total quando consultar status por município", async () => {
    // Dado
    const estacoesSimuladas: EstacaoComStatusOperacional[] = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        codigo: "EST-001",
        nome: "Estação Centro",
        ultimo_ping: "2026-11-11T12:00:00.000Z",
        status_operacional: "Ativa",
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        codigo: "EST-002",
        nome: "Estação Norte",
        ultimo_ping: "2026-11-11T12:01:00.000Z",
        status_operacional: "Ativa",
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        codigo: "EST-003",
        nome: "Estação Sul",
        ultimo_ping: "2026-11-11T10:00:00.000Z",
        status_operacional: "Com Falha",
      },
      {
        id: "44444444-4444-4444-8444-444444444444",
        codigo: "EST-004",
        nome: "Estação Leste",
        ultimo_ping: null,
        status_operacional: "Inativa",
      },
    ];
    mockedEstacaoRepository.findStatusByMunicipio.mockResolvedValue(
      estacoesSimuladas,
    );

    // Quando
    const resultado = await getStatusPublicoPorMunicipio("São José dos Campos");

    // Então
    expect(resultado.resumo).toEqual({
      total: 4,
      ativas: 2,
      com_falha: 1,
      inativas: 1,
    });
    expect(
      resultado.resumo.ativas +
        resultado.resumo.com_falha +
        resultado.resumo.inativas,
    ).toBe(resultado.resumo.total);
    expect(resultado.estacoes).toEqual(estacoesSimuladas);
  });

  it("deve retornar resumo zerado quando o município consultado não possuir estações", async () => {
    // Dado
    mockedEstacaoRepository.findStatusByMunicipio.mockResolvedValue([]);

    // Quando
    const resultado = await getStatusPublicoPorMunicipio("Taubaté");

    // Então
    expect(resultado).toEqual({
      resumo: {
        total: 0,
        ativas: 0,
        com_falha: 0,
        inativas: 0,
      },
      estacoes: [],
    });
  });

  it("deve converter a sigla sjc para São José dos Campos quando consultar status público", async () => {
    // Dado
    mockedEstacaoRepository.findStatusByMunicipio.mockResolvedValue([]);

    // Quando
    await getStatusPublicoPorMunicipio("sjc");

    // Então
    expect(
      mockedEstacaoRepository.findStatusByMunicipio,
    ).toHaveBeenCalledWith("São José dos Campos");
  });
});
