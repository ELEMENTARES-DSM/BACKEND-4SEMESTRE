import jwt from "jsonwebtoken";
import { Request, Response } from "express";
import app from "../../app";
import { authOpcional } from "../../middlewares/auth.middleware";
import { verificarPeriodo } from "../../middlewares/periodo.middleware";
import { verificarMunicipio } from "../../middlewares/municipio.middleware";

const JWT_SECRET = "segredo-de-teste-analise-dados-123";
process.env.JWT_SECRET = JWT_SECRET;

function gerarToken(papel: string, municipio: string | null = null): string {
  return jwt.sign(
    {
      id: "user-test-uuid",
      papel,
      municipio,
    },
    JWT_SECRET,
    { algorithm: "HS256", expiresIn: "1h" }
  );
}

// Dublê simplificado de request/response para testar os middlewares do express
function criarReqRes(options: {
  authorization?: string;
  query?: Record<string, string>;
  auth?: { id: string; papel: string; municipio: string | null };
}) {
  const req: Partial<Request> = {
    headers: options.authorization
      ? { authorization: options.authorization }
      : {},
    query: options.query || {},
    auth: options.auth,
  };

  const res: Partial<Response> = {
    statusCode: 200,
    status(code: number) {
      this.statusCode = code;
      return this as Response;
    },
    json(data: unknown) {
      (this as unknown as { data: unknown }).data = data;
      return this as Response;
    },
  };

  return { req: req as Request, res: res as Response };
}

describe("TASK 42.04 - Limitar o período de consulta por perfil (US-42)", () => {
  it("deve carregar o app com as rotas montadas", () => {
    expect(app).toBeDefined();
  });

  describe("Cenário 3 da US-42: Consulta sem login", () => {
    it("permite consulta de 7 dias sem login (chama next)", () => {
      const { req, res } = criarReqRes({
        query: { periodo: "7d" },
      });
      const next = jest.fn();

      authOpcional(req, res, () => {
        verificarPeriodo(req, res, next);
      });

      expect(next).toHaveBeenCalled();
      expect(res.statusCode).toBe(200);
    });

    it("responde 400 ao solicitar série de 30 dias sem login com limite de 7 dias na mensagem", () => {
      const { req, res } = criarReqRes({
        query: { periodo: "30d" },
      });
      const next = jest.fn();

      authOpcional(req, res, () => {
        verificarPeriodo(req, res, next);
      });

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(400);
      const data = (res as unknown as { data: { erro: string; limiteMaximoDias: number } }).data;
      expect(data.erro).toContain("7 dias");
      expect(data.limiteMaximoDias).toBe(7);
    });
  });

  describe("Cenário 4 da US-42: Consulta com MUNICIPE", () => {
    it("permite série de 30 dias para MUNICIPE", () => {
      const token = gerarToken("MUNICIPE");
      const { req, res } = criarReqRes({
        authorization: `Bearer ${token}`,
        query: { periodo: "30d" },
      });
      const next = jest.fn();

      authOpcional(req, res, () => {
        verificarPeriodo(req, res, next);
      });

      expect(next).toHaveBeenCalled();
      expect(req.auth?.papel).toBe("MUNICIPE");
      expect(res.statusCode).toBe(200);
    });

    it("responde 400 se MUNICIPE solicitar período de 90 dias, informando limite de 30 dias", () => {
      const token = gerarToken("MUNICIPE");
      const { req, res } = criarReqRes({
        authorization: `Bearer ${token}`,
        query: { periodo: "90d" },
      });
      const next = jest.fn();

      authOpcional(req, res, () => {
        verificarPeriodo(req, res, next);
      });

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(400);
      const data = (res as unknown as { data: { erro: string; limiteMaximoDias: number } }).data;
      expect(data.erro).toContain("30 dias");
      expect(data.limiteMaximoDias).toBe(30);
    });
  });

  describe("Perfis Ilimitados: GESTOR_PUBLICO e ADMINISTRADOR", () => {
    it("permite 365 dias para ADMINISTRADOR", () => {
      const token = gerarToken("ADMINISTRADOR");
      const { req, res } = criarReqRes({
        authorization: `Bearer ${token}`,
        query: { periodo: "365d" },
      });
      const next = jest.fn();

      authOpcional(req, res, () => {
        verificarPeriodo(req, res, next);
      });

      expect(next).toHaveBeenCalled();
      expect(res.statusCode).toBe(200);
    });

    it("permite período longo para GESTOR_PUBLICO e valida município", () => {
      const token = gerarToken("GESTOR_PUBLICO", "São José dos Campos");
      const { req, res } = criarReqRes({
        authorization: `Bearer ${token}`,
        query: { periodo: "365d", municipio: "São José dos Campos" },
      });
      const next = jest.fn();

      authOpcional(req, res, () => {
        verificarPeriodo(req, res, () => {
          verificarMunicipio(req, res, next);
        });
      });

      expect(next).toHaveBeenCalled();
      expect(req.municipioEscopo).toBe("São José dos Campos");
    });

    it("responde 404 para GESTOR_PUBLICO tentando acessar município diferente do seu", () => {
      const token = gerarToken("GESTOR_PUBLICO", "São José dos Campos");
      const { req, res } = criarReqRes({
        authorization: `Bearer ${token}`,
        query: { periodo: "7d", municipio: "Jacareí" },
      });
      const next = jest.fn();

      authOpcional(req, res, () => {
        verificarPeriodo(req, res, () => {
          verificarMunicipio(req, res, next);
        });
      });

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(404);
    });
  });
});
