import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import {
  authenticate,
  authorize,
  PERFIS,
} from "../../middlewares/auth.middleware";

const JWT_SECRET = "segredo-teste";

function criarResponse() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };

  return res as unknown as Response & {
    status: jest.Mock;
    json: jest.Mock;
  };
}

function criarRequest(authorization?: string) {
  return {
    headers: {
      authorization,
    },
  } as unknown as Request;
}

function criarToken(payload: Record<string, unknown>) {
  return jwt.sign(payload, JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: "1h",
  });
}

describe("auth.middleware", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = JWT_SECRET;
    jest.clearAllMocks();
  });

  describe("authenticate", () => {
    it("Dado que não existe token, quando autenticar, então deve retornar 401", () => {
      const req = criarRequest();
      const res = criarResponse();
      const next = jest.fn() as NextFunction;

      authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it("Dado um token inválido, quando autenticar, então deve retornar 401", () => {
      const req = criarRequest("Bearer token-invalido");
      const res = criarResponse();
      const next = jest.fn() as NextFunction;

      authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it("Dado um token válido, quando autenticar, então deve disponibilizar os dados do usuário", () => {
      const token = criarToken({
        id: "usuario-1",
        papel: PERFIS.GESTOR_PUBLICO,
        municipio: "municipio-1",
        jti: "token-1",
      });

      const req = criarRequest(`Bearer ${token}`);
      const res = criarResponse();
      const next = jest.fn() as NextFunction;

      authenticate(req, res, next);

      expect(req.auth).toEqual({
        id: "usuario-1",
        papel: PERFIS.GESTOR_PUBLICO,
        municipio: "municipio-1",
        jti: "token-1",
      });
      expect(next).toHaveBeenCalledTimes(1);
    });

    it("Dado um token sem os campos obrigatórios, quando autenticar, então deve retornar 401", () => {
      const token = criarToken({
        id: "usuario-1",
        papel: PERFIS.GESTOR_PUBLICO,
      });

      const req = criarRequest(`Bearer ${token}`);
      const res = criarResponse();
      const next = jest.fn() as NextFunction;

      authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it("Dado que JWT_SECRET não está configurado, quando autenticar, então deve retornar 500", () => {
      delete process.env.JWT_SECRET;

      const token = criarToken({
        id: "usuario-1",
        papel: PERFIS.ADMINISTRADOR,
        municipio: null,
      });

      const req = criarRequest(`Bearer ${token}`);
      const res = criarResponse();
      const next = jest.fn() as NextFunction;

      authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("authorize", () => {
    it("Dado que o usuário não está autenticado, quando autorizar, então deve retornar 401", () => {
      const req = criarRequest();
      const res = criarResponse();
      const next = jest.fn() as NextFunction;

      authorize(PERFIS.ADMINISTRADOR)(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it("Dado um perfil não permitido, quando autorizar, então deve retornar 403", () => {
      const req = criarRequest();
      req.auth = {
        id: "usuario-1",
        papel: PERFIS.PESQUISADOR,
        municipio: null,
      };

      const res = criarResponse();
      const next = jest.fn() as NextFunction;

      authorize(PERFIS.ADMINISTRADOR)(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it("Dado um perfil permitido, quando autorizar, então deve continuar", () => {
      const req = criarRequest();
      req.auth = {
        id: "usuario-1",
        papel: PERFIS.ADMINISTRADOR,
        municipio: null,
      };

      const res = criarResponse();
      const next = jest.fn() as NextFunction;

      authorize(PERFIS.ADMINISTRADOR)(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
