import bcrypt from "bcryptjs";
import * as userService from "../../services/user.service";
import * as userRepository from "../../repositories/user.repository";
import * as papelRepository from "../../repositories/papel.repository";
import { AppError } from "../../middlewares/error-handler";
import { Usuario } from "../../models/user.model";
import { Papel } from "../../models/papel.model";
import { CreateUserDTO } from "../../dto/create-user.dto";

// Os repositories e o bcryptjs são mockados
// testes da regra de negócio do service, sem banco de dados.
jest.mock("../../repositories/user.repository");
jest.mock("../../repositories/papel.repository");
jest.mock("bcryptjs");

const mockUserRepo = jest.mocked(userRepository);
const mockPapelRepo = jest.mocked(papelRepository);
const mockHash = bcrypt.hash as jest.Mock;

// ---------- fixtures ----------

const makeUsuario = (overrides: Partial<Usuario> = {}): Usuario => ({
  id: "user-1",
  nome: "Maria Souza",
  email: "maria@teste.com",
  senha_hash: "hash-existente",
  papel_id: "papel-pesquisador",
  municipio: null,
  esta_ativo: true,
  criado_em: new Date("2026-01-01T00:00:00Z"),
  atualizado_em: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});

const makePapel = (nome: string, id: string): Papel => ({
  id,
  nome,
  descricao: null,
  criado_em: new Date("2026-01-01T00:00:00Z"),
});

const PAPEL_ADMIN = makePapel("ADMINISTRADOR", "papel-admin");
const PAPEL_GESTOR = makePapel("GESTOR_PUBLICO", "papel-gestor");
const PAPEL_PESQUISADOR = makePapel("PESQUISADOR", "papel-pesquisador");

const makeCreateDTO = (overrides: Partial<CreateUserDTO> = {}): CreateUserDTO => ({
  nome: "Maria Souza",
  email: "maria@teste.com",
  senha: "senha12345",
  papel_id: PAPEL_PESQUISADOR.id,
  ...overrides,
});

// Captura o erro lançado e confere tipo, status e mensagem de uma vez só.
const expectAppError = async (
  promise: Promise<unknown>,
  statusCode: number,
  message: string
) => {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(AppError);
  expect(error).toMatchObject({ statusCode, message });
};

// ---------- testes ----------

describe("user.service", () => {
  describe("create", () => {
    it("lança 409 quando o e-mail já está cadastrado", async () => {
      mockUserRepo.findByEmail.mockResolvedValue(makeUsuario());

      await expectAppError(
        userService.create(makeCreateDTO()),
        409,
        "E-mail já cadastrado"
      );

      expect(mockPapelRepo.findById).not.toHaveBeenCalled();
      expect(mockHash).not.toHaveBeenCalled();
      expect(mockUserRepo.create).not.toHaveBeenCalled();
    });

    it("lança 400 quando o papel_id não existe", async () => {
      mockUserRepo.findByEmail.mockResolvedValue(null);
      mockPapelRepo.findById.mockResolvedValue(null);

      await expectAppError(
        userService.create(makeCreateDTO({ papel_id: "papel-inexistente" })),
        400,
        "papel_id inválido: papel não encontrado"
      );

      expect(mockHash).not.toHaveBeenCalled();
      expect(mockUserRepo.create).not.toHaveBeenCalled();
    });

    it("lança 400 quando o papel é GESTOR_PUBLICO e o município não é informado", async () => {
      mockUserRepo.findByEmail.mockResolvedValue(null);
      mockPapelRepo.findById.mockResolvedValue(PAPEL_GESTOR);

      await expectAppError(
        userService.create(makeCreateDTO({ papel_id: PAPEL_GESTOR.id })),
        400,
        "Usuário com papel GESTOR_PUBLICO exige município definido"
      );

      expect(mockUserRepo.create).not.toHaveBeenCalled();
    });

    it("trata município vazio ('') como não informado para GESTOR_PUBLICO", async () => {
      mockUserRepo.findByEmail.mockResolvedValue(null);
      mockPapelRepo.findById.mockResolvedValue(PAPEL_GESTOR);

      await expectAppError(
        userService.create(
          makeCreateDTO({ papel_id: PAPEL_GESTOR.id, municipio: "" })
        ),
        400,
        "Usuário com papel GESTOR_PUBLICO exige município definido"
      );
    });

    it("cria GESTOR_PUBLICO quando o município é informado", async () => {
      mockUserRepo.findByEmail.mockResolvedValue(null);
      mockPapelRepo.findById.mockResolvedValue(PAPEL_GESTOR);
      mockHash.mockResolvedValue("hash-gerado");
      mockUserRepo.create.mockResolvedValue(
        makeUsuario({ papel_id: PAPEL_GESTOR.id, municipio: "Campinas" })
      );

      const result = await userService.create(
        makeCreateDTO({ papel_id: PAPEL_GESTOR.id, municipio: "Campinas" })
      );

      expect(mockUserRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ papel_id: PAPEL_GESTOR.id, municipio: "Campinas" })
      );
      expect(result.municipio).toBe("Campinas");
    });

    it("cria usuário de outro papel sem exigir município", async () => {
      mockUserRepo.findByEmail.mockResolvedValue(null);
      mockPapelRepo.findById.mockResolvedValue(PAPEL_ADMIN);
      mockHash.mockResolvedValue("hash-gerado");
      mockUserRepo.create.mockResolvedValue(
        makeUsuario({ papel_id: PAPEL_ADMIN.id })
      );

      await expect(
        userService.create(makeCreateDTO({ papel_id: PAPEL_ADMIN.id }))
      ).resolves.toBeDefined();
    });

    it("gera o hash com 10 salt rounds e nunca persiste a senha em texto puro", async () => {
      mockUserRepo.findByEmail.mockResolvedValue(null);
      mockPapelRepo.findById.mockResolvedValue(PAPEL_PESQUISADOR);
      mockHash.mockResolvedValue("hash-gerado");
      mockUserRepo.create.mockResolvedValue(makeUsuario());

      await userService.create(makeCreateDTO({ senha: "senha12345" }));

      expect(mockHash).toHaveBeenCalledWith("senha12345", 10);

      const paramsEnviadosAoRepository = mockUserRepo.create.mock.calls[0]![0];
      expect(paramsEnviadosAoRepository.senhaHash).toBe("hash-gerado");
      expect(paramsEnviadosAoRepository).not.toHaveProperty("senha");
    });

    it("retorna o usuário criado sem o campo senha_hash", async () => {
      mockUserRepo.findByEmail.mockResolvedValue(null);
      mockPapelRepo.findById.mockResolvedValue(PAPEL_PESQUISADOR);
      mockHash.mockResolvedValue("hash-gerado");
      mockUserRepo.create.mockResolvedValue(makeUsuario());

      const result = await userService.create(makeCreateDTO());

      expect(result).not.toHaveProperty("senha_hash");
      expect(result).toMatchObject({ id: "user-1", email: "maria@teste.com" });
    });
  });

  describe("findAll", () => {
    it("retorna a lista devolvida pelo repository", async () => {
      const lista = [
        {
          id: "user-1",
          nome: "Maria Souza",
          email: "maria@teste.com",
          papel_id: PAPEL_ADMIN.id,
          papel_nome: "ADMINISTRADOR",
          municipio: null,
          esta_ativo: true,
          criado_em: new Date("2026-01-01T00:00:00Z"),
          atualizado_em: new Date("2026-01-01T00:00:00Z"),
        },
      ];
      mockUserRepo.findAll.mockResolvedValue(lista);

      await expect(userService.findAll()).resolves.toEqual(lista);
    });
  });

  describe("findById", () => {
    it("lança 404 quando o usuário não existe", async () => {
      mockUserRepo.findById.mockResolvedValue(null);

      await expectAppError(
        userService.findById("inexistente"),
        404,
        "Usuário não encontrado"
      );
    });

    it("retorna o usuário sem o campo senha_hash", async () => {
      mockUserRepo.findById.mockResolvedValue(makeUsuario());

      const result = await userService.findById("user-1");

      expect(result).not.toHaveProperty("senha_hash");
      expect(result.id).toBe("user-1");
    });
  });

  describe("update", () => {
    it("lança 404 quando o usuário não existe", async () => {
      mockUserRepo.findById.mockResolvedValue(null);

      await expectAppError(
        userService.update("inexistente", { nome: "Novo Nome" }),
        404,
        "Usuário não encontrado"
      );

      expect(mockUserRepo.update).not.toHaveBeenCalled();
    });

    it("atualiza e retorna o usuário sem senha_hash", async () => {
      mockUserRepo.findById.mockResolvedValue(makeUsuario());
      mockPapelRepo.findById.mockResolvedValue(PAPEL_PESQUISADOR);
      mockUserRepo.update.mockResolvedValue(makeUsuario({ nome: "Novo Nome" }));

      const result = await userService.update("user-1", { nome: "Novo Nome" });

      expect(mockUserRepo.update).toHaveBeenCalledWith("user-1", { nome: "Novo Nome" });
      expect(result.nome).toBe("Novo Nome");
      expect(result).not.toHaveProperty("senha_hash");
    });

    it("valida o papel e município já existentes quando o payload não os altera", async () => {
      // GESTOR_PUBLICO sem município no banco: editar só o nome deve falhar.
      mockUserRepo.findById.mockResolvedValue(
        makeUsuario({ papel_id: PAPEL_GESTOR.id, municipio: null })
      );
      mockPapelRepo.findById.mockResolvedValue(PAPEL_GESTOR);

      await expectAppError(
        userService.update("user-1", { nome: "Novo Nome" }),
        400,
        "Usuário com papel GESTOR_PUBLICO exige município definido"
      );

      expect(mockPapelRepo.findById).toHaveBeenCalledWith(PAPEL_GESTOR.id);
      expect(mockUserRepo.update).not.toHaveBeenCalled();
    });

    it("permite editar GESTOR_PUBLICO que já tem município", async () => {
      mockUserRepo.findById.mockResolvedValue(
        makeUsuario({ papel_id: PAPEL_GESTOR.id, municipio: "Campinas" })
      );
      mockPapelRepo.findById.mockResolvedValue(PAPEL_GESTOR);
      mockUserRepo.update.mockResolvedValue(
        makeUsuario({ papel_id: PAPEL_GESTOR.id, municipio: "Campinas", nome: "Novo Nome" })
      );

      await expect(
        userService.update("user-1", { nome: "Novo Nome" })
      ).resolves.toMatchObject({ nome: "Novo Nome" });
    });

    it("lança 400 ao trocar o papel para GESTOR_PUBLICO sem informar município", async () => {
      mockUserRepo.findById.mockResolvedValue(makeUsuario({ municipio: null }));
      mockPapelRepo.findById.mockResolvedValue(PAPEL_GESTOR);

      await expectAppError(
        userService.update("user-1", { papel_id: PAPEL_GESTOR.id }),
        400,
        "Usuário com papel GESTOR_PUBLICO exige município definido"
      );

      expect(mockPapelRepo.findById).toHaveBeenCalledWith(PAPEL_GESTOR.id);
    });

    it("permite trocar para GESTOR_PUBLICO informando o município", async () => {
      mockUserRepo.findById.mockResolvedValue(makeUsuario({ municipio: null }));
      mockPapelRepo.findById.mockResolvedValue(PAPEL_GESTOR);
      mockUserRepo.update.mockResolvedValue(
        makeUsuario({ papel_id: PAPEL_GESTOR.id, municipio: "Santos" })
      );

      await userService.update("user-1", {
        papel_id: PAPEL_GESTOR.id,
        municipio: "Santos",
      });

      expect(mockUserRepo.update).toHaveBeenCalledWith("user-1", {
        papel_id: PAPEL_GESTOR.id,
        municipio: "Santos",
      });
    });

    it("lança 400 quando o novo papel_id não existe", async () => {
      mockUserRepo.findById.mockResolvedValue(makeUsuario());
      mockPapelRepo.findById.mockResolvedValue(null);

      await expectAppError(
        userService.update("user-1", { papel_id: "papel-inexistente" }),
        400,
        "papel_id inválido: papel não encontrado"
      );

      expect(mockUserRepo.update).not.toHaveBeenCalled();
    });
  });

  describe("updateStatus", () => {
    it("lança 404 quando o usuário não existe", async () => {
      mockUserRepo.findById.mockResolvedValue(null);

      await expectAppError(
        userService.updateStatus("inexistente", false),
        404,
        "Usuário não encontrado"
      );

      expect(mockUserRepo.update).not.toHaveBeenCalled();
    });

    it("inativa o usuário (esta_ativo = false)", async () => {
      mockUserRepo.findById.mockResolvedValue(makeUsuario());
      mockUserRepo.update.mockResolvedValue(makeUsuario({ esta_ativo: false }));

      const result = await userService.updateStatus("user-1", false);

      expect(mockUserRepo.update).toHaveBeenCalledWith("user-1", { esta_ativo: false });
      expect(result.esta_ativo).toBe(false);
      expect(result).not.toHaveProperty("senha_hash");
    });

    it("reativa o usuário (esta_ativo = true)", async () => {
      mockUserRepo.findById.mockResolvedValue(makeUsuario({ esta_ativo: false }));
      mockUserRepo.update.mockResolvedValue(makeUsuario({ esta_ativo: true }));

      const result = await userService.updateStatus("user-1", true);

      expect(mockUserRepo.update).toHaveBeenCalledWith("user-1", { esta_ativo: true });
      expect(result.esta_ativo).toBe(true);
    });

    it("não revalida papel/município (permite inativar cadastro legado inválido)", async () => {
      mockUserRepo.findById.mockResolvedValue(
        makeUsuario({ papel_id: PAPEL_GESTOR.id, municipio: null })
      );
      mockUserRepo.update.mockResolvedValue(
        makeUsuario({ papel_id: PAPEL_GESTOR.id, municipio: null, esta_ativo: false })
      );

      await expect(userService.updateStatus("user-1", false)).resolves.toBeDefined();
      expect(mockPapelRepo.findById).not.toHaveBeenCalled();
    });
  });

  describe("inativar (soft delete)", () => {
    it("lança 404 quando o usuário não existe", async () => {
      mockUserRepo.findById.mockResolvedValue(null);

      await expectAppError(
        userService.inativar("inexistente"),
        404,
        "Usuário não encontrado"
      );

      expect(mockUserRepo.softDelete).not.toHaveBeenCalled();
    });

    it("chama softDelete com o id do usuário", async () => {
      mockUserRepo.findById.mockResolvedValue(makeUsuario());
      mockUserRepo.softDelete.mockResolvedValue(makeUsuario({ esta_ativo: false }));

      await userService.inativar("user-1");

      expect(mockUserRepo.softDelete).toHaveBeenCalledWith("user-1");
      expect(mockUserRepo.hardDelete).not.toHaveBeenCalled();
    });
  });

  describe("remove (hard delete)", () => {
    it("lança 404 quando o usuário não existe", async () => {
      mockUserRepo.findById.mockResolvedValue(null);

      await expectAppError(
        userService.remove("inexistente"),
        404,
        "Usuário não encontrado"
      );

      expect(mockUserRepo.hardDelete).not.toHaveBeenCalled();
    });

    it("chama hardDelete com o id do usuário", async () => {
      mockUserRepo.findById.mockResolvedValue(makeUsuario());
      mockUserRepo.hardDelete.mockResolvedValue(makeUsuario());

      await userService.remove("user-1");

      expect(mockUserRepo.hardDelete).toHaveBeenCalledWith("user-1");
      expect(mockUserRepo.softDelete).not.toHaveBeenCalled();
    });
  });
});