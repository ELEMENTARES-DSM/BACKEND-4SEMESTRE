import * as papelService from "../../services/papel.service";
import * as papelRepository from "../../repositories/papel.repository";
import { AppError } from "../../middlewares/error-handler";
import { Papel } from "../../models/papel.model";

jest.mock("../../repositories/papel.repository");

const mockPapelRepo = jest.mocked(papelRepository);

const makePapel = (nome: string, id: string): Papel => ({
  id,
  nome,
  descricao: null,
  criado_em: new Date("2026-01-01T00:00:00Z"),
});

const PAPEL_ADMIN = makePapel("ADMINISTRADOR", "papel-admin");
const PAPEL_GESTOR = makePapel("GESTOR_PUBLICO", "papel-gestor");
const PAPEL_PESQUISADOR = makePapel("PESQUISADOR", "papel-pesquisador");

describe("papel.service", () => {
  describe("findAll", () => {
    it("retorna a lista de papéis devolvida pelo repository", async () => {
      const lista = [PAPEL_ADMIN, PAPEL_GESTOR, PAPEL_PESQUISADOR];
      mockPapelRepo.findAll.mockResolvedValue(lista);

      await expect(papelService.findAll()).resolves.toEqual(lista);
      expect(mockPapelRepo.findAll).toHaveBeenCalledTimes(1);
    });

    it("retorna lista vazia quando não há papéis cadastrados", async () => {
      mockPapelRepo.findAll.mockResolvedValue([]);

      await expect(papelService.findAll()).resolves.toEqual([]);
    });

    it("propaga o erro do repository (não engole falhas)", async () => {
      mockPapelRepo.findAll.mockRejectedValue(new Error("falha no banco"));

      await expect(papelService.findAll()).rejects.toThrow("falha no banco");
    });
  });

  describe("findById", () => {
    it("retorna o papel quando ele existe", async () => {
      mockPapelRepo.findById.mockResolvedValue(PAPEL_GESTOR);

      await expect(papelService.findById("papel-gestor")).resolves.toEqual(
        PAPEL_GESTOR
      );
      expect(mockPapelRepo.findById).toHaveBeenCalledWith("papel-gestor");
    });

    it("lança AppError 404 quando o papel não existe", async () => {
      mockPapelRepo.findById.mockResolvedValue(null);

      const error = await papelService.findById("inexistente").then(
        () => null,
        (e: unknown) => e
      );

      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        statusCode: 404,
        message: "Papel não encontrado",
      });
    });

    it("propaga o erro do repository (não engole falhas)", async () => {
      mockPapelRepo.findById.mockRejectedValue(new Error("falha no banco"));

      await expect(papelService.findById("papel-gestor")).rejects.toThrow(
        "falha no banco"
      );
    });
  });
});