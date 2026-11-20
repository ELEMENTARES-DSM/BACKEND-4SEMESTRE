import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { authMiddleware } from "../../middlewares/middleware";

const SEGREDO = "segredo-unitario-relatorios";

function respostaFalsa() {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

describe("middleware (US-31)", () => {
  describe("authMiddleware", () => {
    const segredoAnterior = process.env.JWT_SECRET;

    beforeEach(() => {
      process.env.JWT_SECRET = SEGREDO;
    });

    afterEach(() => {
      if (segredoAnterior === undefined) {
        delete process.env.JWT_SECRET;
      } else {
        process.env.JWT_SECRET = segredoAnterior;
      }
    });

    it("deve responder 401 quando o header Authorization não é enviado", () => {
      // Dado:
      const req = { headers: {} } as unknown as Request;
      const res = respostaFalsa();
      const next = jest.fn() as unknown as NextFunction;

      // Quando:
      authMiddleware(req, res as unknown as Response, next);

      // Então:
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        erro: "Autenticação necessária. Token não informado ou formato inválido.",
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("deve responder 401 quando o header Authorization não começa com Bearer", () => {
      // Dado:
      const req = { headers: { authorization: "Basic abc123" } } as unknown as Request;
      const res = respostaFalsa();
      const next = jest.fn() as unknown as NextFunction;

      // Quando:
      authMiddleware(req, res as unknown as Response, next);

      // Então:
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        erro: "Autenticação necessária. Token não informado ou formato inválido.",
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("deve preencher req.usuario e chamar next quando o token é válido", () => {
      // Dado:
      const token = jwt.sign(
        { id: "usuario-1", papel: "GESTOR_PUBLICO", municipio: "São José dos Campos" },
        SEGREDO,
        { algorithm: "HS256" },
      );
      const req = { headers: { authorization: `Bearer ${token}` } } as unknown as Request;
      const res = respostaFalsa();
      const next = jest.fn() as unknown as NextFunction;

      // Quando:
      authMiddleware(req, res as unknown as Response, next);

      // Então:
      expect(req.usuario).toEqual({
        id: "usuario-1",
        papel: "GESTOR_PUBLICO",
        municipio: "São José dos Campos",
      });
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it("deve definir municipio como null quando o token válido não informa município", () => {
      // Dado:
      const token = jwt.sign({ id: "admin-1", papel: "ADMINISTRADOR" }, SEGREDO, { algorithm: "HS256" });
      const req = { headers: { authorization: `Bearer ${token}` } } as unknown as Request;
      const res = respostaFalsa();
      const next = jest.fn() as unknown as NextFunction;

      // Quando:
      authMiddleware(req, res as unknown as Response, next);

      // Então:
      expect(req.usuario).toEqual({
        id: "admin-1",
        papel: "ADMINISTRADOR",
        municipio: null,
      });
      expect(next).toHaveBeenCalledTimes(1);
    });

    it("deve responder 401 quando o token é inválido ou foi assinado com outro segredo", () => {
      // Dado:
      const tokenInvalido = jwt.sign({ id: "usuario-1", papel: "ADMINISTRADOR" }, "outro-segredo", {
        algorithm: "HS256",
      });
      const req = { headers: { authorization: `Bearer ${tokenInvalido}` } } as unknown as Request;
      const res = respostaFalsa();
      const next = jest.fn() as unknown as NextFunction;

      // Quando:
      authMiddleware(req, res as unknown as Response, next);

      // Então:
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        erro: "Token inválido ou expirado.",
      });
      expect(next).not.toHaveBeenCalled();
    });
  });
});
