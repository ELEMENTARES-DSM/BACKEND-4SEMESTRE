import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { authenticate, authorize } from "../../middlewares/auth";
import * as tokenBlacklist from "../../services/token-blacklist.service";

jest.mock("../../services/token-blacklist.service");

const mockTokenEstaRevogado = tokenBlacklist.tokenEstaRevogado as jest.Mock;

describe("middlewares/auth (gestao-usuarios)", () => {
  const JWT_SECRET = "segredo-teste-gestao-usuarios";
  const res = {} as Response;
  let next: NextFunction;

  beforeAll(() => {
    process.env.JWT_SECRET = JWT_SECRET;
  });

  beforeEach(() => {
    next = jest.fn();
  });

  describe("authenticate", () => {
    it("deve lançar AppError 401 quando header Authorization não existe ou não começa com Bearer", async () => {
      const req = { headers: {} } as Request;
      await expect(authenticate(req, res, next)).rejects.toMatchObject({
        statusCode: 401,
        message: "Token não fornecido",
      });
    });

    it("deve lançar AppError 401 quando o token é inválido", async () => {
      const req = { headers: { authorization: "Bearer invalido" } } as Request;
      await expect(authenticate(req, res, next)).rejects.toMatchObject({
        statusCode: 401,
        message: "Token inválido ou expirado",
      });
    });

    it("deve lançar AppError 401 quando o token está revogado", async () => {
      const token = jwt.sign(
        { id: "u1", papel: "ADMINISTRADOR", municipio: null, jti: "jti-rev" },
        JWT_SECRET,
        { algorithm: "HS256" }
      );
      mockTokenEstaRevogado.mockResolvedValue(true);

      const req = { headers: { authorization: `Bearer ${token}` } } as Request;
      await expect(authenticate(req, res, next)).rejects.toMatchObject({
        statusCode: 401,
        message: "Token inválido ou expirado",
      });
    });

    it("deve popular req.auth e chamar next quando o token é válido", async () => {
      const token = jwt.sign(
        { id: "u1", papel: "ADMINISTRADOR", municipio: null, jti: "jti-ok" },
        JWT_SECRET,
        { algorithm: "HS256" }
      );
      mockTokenEstaRevogado.mockResolvedValue(false);

      const req = { headers: { authorization: `Bearer ${token}` } } as Request;
      await authenticate(req, res, next);

      expect(req.auth).toMatchObject({ id: "u1", papel: "ADMINISTRADOR" });
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe("authorize", () => {
    it("deve lançar AppError 401 quando req.auth está ausente", () => {
      const req = {} as Request;
      expect(() => authorize("ADMINISTRADOR")(req, res, next)).toThrow("Não autenticado");
    });

    it("deve lançar AppError 403 quando papel não é permitido", () => {
      const req = { auth: { id: "u1", papel: "MUNICIPE", municipio: null } } as Request;
      expect(() => authorize("ADMINISTRADOR")(req, res, next)).toThrow(
        "Acesso negado: permissão insuficiente"
      );
    });

    it("deve chamar next quando papel é permitido", () => {
      const req = { auth: { id: "u1", papel: "ADMINISTRADOR", municipio: null } } as Request;
      authorize("ADMINISTRADOR")(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });
});
