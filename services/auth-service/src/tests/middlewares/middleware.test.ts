import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { authMiddleware, checkRole } from "../../middlewares/middleware";
import * as tokenBlacklist from "../../services/token-blacklist.service";

jest.mock("jsonwebtoken");
jest.mock("../../services/token-blacklist.service");

const mockVerify = jwt.verify as jest.Mock;
const mockTokenEstaRevogado = tokenBlacklist.tokenEstaRevogado as jest.Mock;

function criarRes(): Response {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

describe("auth-service middlewares", () => {
  let next: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();
    next = jest.fn();
  });

  describe("authMiddleware", () => {
    it("deve retornar 401 quando header Authorization está ausente ou fora do padrão Bearer", async () => {
      const req = { headers: {} } as Request;
      const res = criarRes();

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it("deve retornar 401 quando o token é inválido (instância de Error)", async () => {
      const req = { headers: { authorization: "Bearer invalido" } } as Request;
      const res = criarRes();
      mockVerify.mockImplementation(() => {
        throw new Error("jwt malformed");
      });

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        erro: "Token inválido ou expirado.",
        if: "jwt malformed",
      });
    });

    it("deve retornar 401 com mensagem genérica quando erro lançado não é Error", async () => {
      const req = { headers: { authorization: "Bearer invalido" } } as Request;
      const res = criarRes();
      mockVerify.mockImplementation(() => {
        throw "falha-nao-error";
      });

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        erro: "Token inválido ou expirado.",
        if: "Erro desconhecido",
      });
    });

    it("deve retornar 401 quando o token foi revogado na blacklist", async () => {
      const req = { headers: { authorization: "Bearer revogado" } } as Request;
      const res = criarRes();
      mockVerify.mockReturnValue({
        id: "u1",
        papel: "ADMINISTRADOR",
        municipio: null,
        jti: "jti-revogado",
      });
      mockTokenEstaRevogado.mockResolvedValue(true);

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        erro: "Token inválido ou expirado.",
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("deve popular req.usuario e chamar next quando o token é válido", async () => {
      const req = { headers: { authorization: "Bearer valido" } } as Request;
      const res = criarRes();
      mockVerify.mockReturnValue({
        id: "u1",
        papel: "GESTOR_PUBLICO",
        municipio: "São José dos Campos",
        jti: "jti-ok",
      });
      mockTokenEstaRevogado.mockResolvedValue(false);

      await authMiddleware(req, res, next);

      expect(req.usuario).toEqual({
        id: "u1",
        papel: "GESTOR_PUBLICO",
        municipio: "São José dos Campos",
      });
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe("checkRole", () => {
    it("deve retornar 401 quando req.usuario não está definido", () => {
      const req = {} as Request;
      const res = criarRes();

      checkRole(["ADMINISTRADOR"])(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it("deve retornar 403 quando o papel não é permitido", () => {
      const req = {
        usuario: { id: "u1", papel: "MUNICIPE", municipio: null },
      } as unknown as Request;
      const res = criarRes();

      checkRole(["ADMINISTRADOR"])(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it("deve chamar next quando o papel é permitido", () => {
      const req = {
        usuario: { id: "u1", papel: "ADMINISTRADOR", municipio: null },
      } as unknown as Request;
      const res = criarRes();

      checkRole(["ADMINISTRADOR"])(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });
  });
});
