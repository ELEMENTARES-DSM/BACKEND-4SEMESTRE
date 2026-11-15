import { Server } from "node:http";
import { AddressInfo } from "node:net";
import app from "../../app";
import * as estacaoRepository from "../../repositories/estacao.repository";
import { EstacaoComStatusOperacional } from "../../models/estacao.model";

jest.mock("../../repositories/estacao.repository");

const mockedEstacaoRepository = jest.mocked(estacaoRepository);

describe("public-estacao.routes (ELEM-202)", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll((done) => {
    server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("deve retornar 200 e objeto com municípios quando acessar GET /estacoes/publico/municipios sem token", async () => {
    // Dado
    mockedEstacaoRepository.findDistinctMunicipios.mockResolvedValue([
      "São José dos Campos",
    ]);

    // Quando
    const response = await fetch(`${baseUrl}/estacoes/publico/municipios`);
    const body = await response.json();

    // Então
    expect(response.status).toBe(200);
    expect(body).toEqual({
      municipios: ["São José dos Campos"],
    });
  });

  it("deve retornar 200 e soma consistente de status quando acessar GET /estacoes/publico/sjc/status sem token", async () => {
    // Dado
    const estacoesSimuladas: EstacaoComStatusOperacional[] = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        codigo: "EST-001",
        nome: "Estação Parque Vicentina Aranha",
        ultimo_ping: "2026-11-11T12:00:00.000Z",
        status_operacional: "Ativa",
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        codigo: "EST-002",
        nome: "Estação Jardim Aquarius",
        ultimo_ping: "2026-11-11T10:00:00.000Z",
        status_operacional: "Com Falha",
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        codigo: "EST-003",
        nome: "Estação Santana",
        ultimo_ping: null,
        status_operacional: "Inativa",
      },
    ];
    mockedEstacaoRepository.findStatusByMunicipio.mockResolvedValue(
      estacoesSimuladas,
    );

    // Quando
    const response = await fetch(`${baseUrl}/estacoes/publico/sjc/status`);
    const body = await response.json();

    // Então
    expect(response.status).toBe(200);
    expect(
      mockedEstacaoRepository.findStatusByMunicipio,
    ).toHaveBeenCalledWith("São José dos Campos");
    expect(body.resumo).toEqual({
      total: 3,
      ativas: 1,
      com_falha: 1,
      inativas: 1,
    });
    expect(
      body.resumo.ativas + body.resumo.com_falha + body.resumo.inativas,
    ).toBe(body.resumo.total);
  });

  it("deve responder em menos de 200 ms quando acessar GET /estacoes/publico/sjc/status (RNF-10)", async () => {
    // Dado
    mockedEstacaoRepository.findStatusByMunicipio.mockResolvedValue([]);
    const inicio = performance.now();

    // Quando
    const response = await fetch(`${baseUrl}/estacoes/publico/sjc/status`);
    const duracaoMs = performance.now() - inicio;

    // Então
    expect(response.status).toBe(200);
    expect(duracaoMs).toBeLessThan(200);
  });

  it("deve retornar obrigatoriamente 401 quando acessar a rota privada GET /estacoes/status sem token", async () => {
    // Dado / Quando
    const response = await fetch(`${baseUrl}/estacoes/status`);
    const body = await response.json();

    // Então
    expect(response.status).toBe(401);
    expect(body).toEqual({
      erro: "Autenticação necessária. Token não informado ou formato inválido.",
    });
  });
});
