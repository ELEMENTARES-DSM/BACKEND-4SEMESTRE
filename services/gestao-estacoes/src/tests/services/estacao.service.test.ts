import * as estacaoRepository from "../../repositories/estacao.repository";
import * as estacaoService from "../../services/estacao.service";
import { Estacoes } from "../../models/estacao.model";

jest.mock("../../repositories/estacao.repository", () => ({
  findByCodigo: jest.fn(),
  findByMac: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
}));

const estacoes = jest.mocked(estacaoRepository);

const ID = "11111111-1111-4111-8111-111111111111";
const OUTRO_ID = "22222222-2222-4222-8222-222222222222";
const MUNICIPIO = "São José dos Campos";
const estacao = {
  id: ID,
  mac_address: "aabbccddee01",
  codigo: "EST-001",
  nome: "Estação Centro",
  municipio: MUNICIPIO,
} as Estacoes;
const gestor = { papel: "GESTOR_PUBLICO", municipio: MUNICIPIO } as const;
const gestorDeOutroMunicipio = { papel: "GESTOR_PUBLICO", municipio: "Jacareí" } as const;

const dadosValidos = {
  mac_address: "aabbccddee02",
  codigo: "EST-002",
  nome: "Estação Nova",
  municipio: MUNICIPIO,
  latitude: -23.18,
  longitude: -45.88,
};

beforeEach(() => {
  jest.clearAllMocks();
  estacoes.findByCodigo.mockResolvedValue(null);
  estacoes.findByMac.mockResolvedValue(null);
  estacoes.findById.mockResolvedValue(estacao);
  estacoes.create.mockResolvedValue({ ...estacao, ...dadosValidos } as Estacoes);
  estacoes.update.mockResolvedValue(estacao);
});

describe("create (MAC da placa)", () => {
  it("cadastra quando o código e o MAC estão livres, passando o MAC ao repositório", async () => {
    await estacaoService.create(dadosValidos);

    expect(estacoes.create).toHaveBeenCalledWith(
      expect.objectContaining({ mac_address: "aabbccddee02", codigo: "EST-002" }),
    );
  });

  it("recusa com 409 quando o código já existe", async () => {
    estacoes.findByCodigo.mockResolvedValue(estacao);

    await expect(estacaoService.create(dadosValidos)).rejects.toMatchObject({
      statusCode: 409,
      message: "Identificador de estação já cadastrado no sistema",
    });
    expect(estacoes.create).not.toHaveBeenCalled();
  });

  it("recusa com 409 quando o MAC já está em outra estação", async () => {
    estacoes.findByMac.mockResolvedValue(estacao);

    await expect(estacaoService.create(dadosValidos)).rejects.toMatchObject({
      statusCode: 409,
      message: "MAC já cadastrado em outra estação",
    });
    expect(estacoes.create).not.toHaveBeenCalled();
  });

  it("recusa coordenadas fora dos limites com 400", async () => {
    await expect(estacaoService.create({ ...dadosValidos, latitude: 91 })).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(estacoes.create).not.toHaveBeenCalled();
  });
});

describe("update (troca de MAC)", () => {
  it("recusa com 404 quando a estação não existe", async () => {
    estacoes.findById.mockResolvedValue(null);

    await expect(estacaoService.update(ID, { nome: "X" })).rejects.toMatchObject({ statusCode: 404 });
  });

  it("recusa com 409 quando o novo MAC pertence a outra estação", async () => {
    estacoes.findByMac.mockResolvedValue({ ...estacao, id: OUTRO_ID });

    await expect(estacaoService.update(ID, { mac_address: "aabbccddee09" })).rejects.toMatchObject({
      statusCode: 409,
      message: "MAC já cadastrado em outra estação",
    });
    expect(estacoes.update).not.toHaveBeenCalled();
  });

  it("aceita manter o próprio MAC (a estação é a dona dele)", async () => {
    estacoes.findByMac.mockResolvedValue(estacao);

    await estacaoService.update(ID, { mac_address: "aabbccddee01" });

    expect(estacoes.update).toHaveBeenCalledWith(ID, { mac_address: "aabbccddee01" });
  });

  it("não consulta o MAC quando a atualização não envia mac_address", async () => {
    await estacaoService.update(ID, { nome: "Novo nome" });

    expect(estacoes.findByMac).not.toHaveBeenCalled();
    expect(estacoes.update).toHaveBeenCalled();
  });

  it("recusa com 400 coordenadas fora dos limites", async () => {
    await expect(estacaoService.update(ID, { longitude: 181 })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("recusa com 403 quando o gestor edita estação de outro município", async () => {
    await expect(estacaoService.update(ID, { nome: "X" }, gestorDeOutroMunicipio)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(estacoes.update).not.toHaveBeenCalled();
  });

  it("permite ao gestor editar estação do próprio município", async () => {
    await estacaoService.update(ID, { nome: "X" }, gestor);

    expect(estacoes.update).toHaveBeenCalled();
  });
});