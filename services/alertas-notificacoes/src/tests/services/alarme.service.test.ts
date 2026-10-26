import * as alarmeService from "../../services/alarme.service";
import * as alarmeRepository from "../../repositories/alarme.repository";
import { Alarme } from "../../models/alarme.model";
import { UsuarioPayload } from "../../types/express";

jest.mock("../../repositories/alarme.repository");

const repo = jest.mocked(alarmeRepository);

const gestor: UsuarioPayload = { id: "1", papel: "GESTOR_PUBLICO", municipio: "São José dos Campos" };
const admin: UsuarioPayload = { id: "2", papel: "ADMINISTRADOR", municipio: null };
const pesquisador: UsuarioPayload = { id: "3", papel: "PESQUISADOR", municipio: null };

const alarme = (municipio: string) => ({ id: "alarme-1", municipio }) as Alarme;

describe("alarme.service (US-24)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("gestor consulta só o próprio município; administrador consulta todos", async () => {
    repo.findAll.mockResolvedValue([]);

    await alarmeService.list(gestor, { severidade: "CRITICO" });
    await alarmeService.list(admin, {});

    expect(repo.findAll.mock.calls).toEqual([
      [{ severidade: "CRITICO" }, "São José dos Campos"],
      [{}, null],
    ]);
  });

  it("pesquisador é barrado antes de consultar o banco", async () => {
    await expect(alarmeService.list(pesquisador, {})).rejects.toMatchObject({ statusCode: 403 });
    await expect(alarmeService.resumo(pesquisador)).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.findAll).not.toHaveBeenCalled();
    expect(repo.resumoAbertos).not.toHaveBeenCalled();
  });

  it("detalhe de outro município responde 404 com a mesma mensagem do inexistente", async () => {
    repo.findById.mockResolvedValueOnce(alarme("São Paulo")).mockResolvedValueOnce(null);

    await expect(alarmeService.findById(gestor, "alarme-1")).rejects.toMatchObject({
      statusCode: 404,
      message: "Alarme não encontrado.",
    });
    await expect(alarmeService.findById(gestor, "alarme-1")).rejects.toMatchObject({
      statusCode: 404,
      message: "Alarme não encontrado.",
    });
  });

  it("administrador vê o detalhe de qualquer município", async () => {
    repo.findById.mockResolvedValue(alarme("São Paulo"));

    await expect(alarmeService.findById(admin, "alarme-1")).resolves.toEqual(alarme("São Paulo"));
  });
});
