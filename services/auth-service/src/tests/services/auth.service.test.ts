import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { login, logout } from "../../services/auth.service";
import * as userRepository from "../../repositories/user.repository";
import * as tokenBlacklist from "../../services/token-blacklist.service";
import { AppError } from "../../middlewares/error-handler";

jest.mock("bcryptjs");
jest.mock("jsonwebtoken");
jest.mock("../../repositories/user.repository");
jest.mock("../../services/token-blacklist.service");

const mockFindByEmail = userRepository.findByEmailComPapel as jest.Mock;
const mockCompare = bcrypt.compare as jest.Mock;
const mockSign = jwt.sign as jest.Mock;
const mockRevogarToken = tokenBlacklist.revogarToken as jest.Mock;

describe("auth.service", () => {
  const usuarioAtivo = {
    id: "user-1",
    nome: "Maria Silva",
    email: "maria@example.com",
    senha_hash: "$2a$10$hash",
    esta_ativo: true,
    papel: "ADMINISTRADOR",
    municipio: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("login", () => {
    it("deve lançar AppError 401 quando o usuário não existe", async () => {
      mockFindByEmail.mockResolvedValue(null);

      await expect(
        login({ email: "naoexiste@example.com", senha: "123" })
      ).rejects.toEqual(expect.objectContaining({ statusCode: 401 }));
    });

    it("deve lançar AppError 403 quando a conta está inativa", async () => {
      mockFindByEmail.mockResolvedValue({ ...usuarioAtivo, esta_ativo: false });

      await expect(
        login({ email: usuarioAtivo.email, senha: "123" })
      ).rejects.toMatchObject({
        statusCode: 403,
        message: "Acesso revogado. Conta inativa.",
      });
      expect(mockCompare).not.toHaveBeenCalled();
    });

    it("deve lançar AppError 401 quando a senha está incorreta", async () => {
      mockFindByEmail.mockResolvedValue(usuarioAtivo);
      mockCompare.mockResolvedValue(false);

      await expect(
        login({ email: usuarioAtivo.email, senha: "errada" })
      ).rejects.toBeInstanceOf(AppError);
    });

    it("deve retornar token JWT e dados do usuário quando credenciais são válidas", async () => {
      mockFindByEmail.mockResolvedValue(usuarioAtivo);
      mockCompare.mockResolvedValue(true);
      mockSign.mockReturnValue("jwt-token-gerado");

      const resultado = await login({
        email: usuarioAtivo.email,
        senha: "correta",
      });

      expect(mockSign).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "user-1",
          papel: "ADMINISTRADOR",
          municipio: null,
          jti: expect.any(String),
        }),
        undefined,
        { algorithm: "HS256", expiresIn: 8 * 60 * 60 }
      );
      expect(resultado).toEqual({
        token: "jwt-token-gerado",
        usuario: {
          id: "user-1",
          nome: "Maria Silva",
          papel: "ADMINISTRADOR",
          municipio: null,
        },
      });
    });
  });

  describe("logout", () => {
    it("não deve revogar quando payload não possui jti ou exp", async () => {
      await logout({ id: "user-1" });
      await logout({ id: "user-1", jti: "abc" });
      await logout({ id: "user-1", exp: 9999999999 });

      expect(mockRevogarToken).not.toHaveBeenCalled();
    });

    it("deve revogar token quando payload possui jti e exp", async () => {
      mockRevogarToken.mockResolvedValue(undefined);

      await logout({ id: "user-1", jti: "jti-123", exp: 1800000000 });

      expect(mockRevogarToken).toHaveBeenCalledWith("jti-123", 1800000000);
    });
  });
});
