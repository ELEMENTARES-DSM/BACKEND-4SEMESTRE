import jwt from "jsonwebtoken";
import { Request, Response } from "express";
import { authOpcional } from "../../middlewares/auth.middleware";
import { aplicarCotaEAuditar } from "../../middlewares/cota.middleware";
import { limparMemoryStore } from "../../services/cota.service";
import { COTAS_POR_PERFIL } from "../../config/cotas";

const JWT_SECRET = "segredo-de-teste-analise-dados-123";
process.env.JWT_SECRET = JWT_SECRET;

function gerarToken(papel: string, id = "user-123", municipio: string | null = null): string {
  return jwt.sign(
    {
      id,
      papel,
      municipio,
    },
    JWT_SECRET,
    { algorithm: "HS256", expiresIn: "1h" }
  );
}

function criarReqRes(options: {
  authorization?: string;
  url?: string;
  query?: Record<string, string>;
}) {
  const headers: Record<string, string> = {};
  if (options.authorization) {
    headers.authorization = options.authorization;
  }

  const responseHeaders: Record<string, string> = {};

  const req: Partial<Request> = {
    headers,
    originalUrl: options.url || "/analise/estacoes/1/series",
    url: options.url || "/analise/estacoes/1/series",
    query: options.query || {},
  };

  const res: Partial<Response> = {
    statusCode: 200,
    setHeader(name: string, value: string | number | readonly string[]) {
      responseHeaders[name.toLowerCase()] = String(value);
      return this as Response;
    },
    status(code: number) {
      this.statusCode = code;
      return this as Response;
    },
    json(data: unknown) {
      (this as unknown as { data: unknown }).data = data;
      return this as Response;
    },
  };

  return { req: req as Request, res: res as Response, responseHeaders };
}

describe("Cota Middleware e Rastreamento de Uso (Task 42.05)", () => {
  beforeEach(() => {
    limparMemoryStore();
  });

  it("não aplica cota para requisições sem token (anônimas)", async () => {
    const { req, res, responseHeaders } = criarReqRes({});
    const next = jest.fn();

    authOpcional(req, res, () => {
      aplicarCotaEAuditar(req, res, next);
    });

    expect(next).toHaveBeenCalled();
    expect(responseHeaders["x-cota-semana-restante"]).toBeUndefined();
  });

  it("injeta headers de cota restante para MUNICIPE autenticado", async () => {
    const token = gerarToken("MUNICIPE");
    const { req, res, responseHeaders } = criarReqRes({
      authorization: `Bearer ${token}`,
    });
    const next = jest.fn();

    await new Promise<void>((resolve) => {
      authOpcional(req, res, () => {
        aplicarCotaEAuditar(req, res, () => {
          next();
          resolve();
        });
      });
    });

    expect(next).toHaveBeenCalled();
    expect(responseHeaders["x-cota-semana-restante"]).toBe("1999");
    expect(responseHeaders["x-cota-mes-restante"]).toBe("5999");
  });

  it("responde 429 com data de renovação quando a cota semanal é esgotada (Cenário 5 da US-42)", async () => {
    const limiteOriginal = COTAS_POR_PERFIL.MUNICIPE!.semanal;
    try {
      COTAS_POR_PERFIL.MUNICIPE!.semanal = 1;

      const token = gerarToken("MUNICIPE", "municipe-teste-429");

      // 1ª requisição (consome a única cota disponível)
      const req1 = criarReqRes({ authorization: `Bearer ${token}` });
      await new Promise<void>((resolve) => {
        authOpcional(req1.req, req1.res, () => {
          aplicarCotaEAuditar(req1.req, req1.res, () => {
            resolve();
          });
        });
      });
      expect(req1.res.statusCode).toBe(200);

      // 2ª requisição (deve responder 429)
      const req2 = criarReqRes({ authorization: `Bearer ${token}` });
      const next2 = jest.fn();
      await new Promise<void>((resolve) => {
        authOpcional(req2.req, req2.res, () => {
          aplicarCotaEAuditar(req2.req, req2.res, () => {
            next2();
            resolve();
          });
        });
      });

      expect(next2).not.toHaveBeenCalled();
      expect(req2.res.statusCode).toBe(429);
      const data = (req2.res as unknown as { data: { erro: string; renovaEm: string } }).data;
      expect(data.erro).toContain("excedido");
      expect(data.renovaEm).toBeDefined();
    } finally {
      COTAS_POR_PERFIL.MUNICIPE!.semanal = limiteOriginal;
    }
  });

  it("não debita cota em rotas de status de estações", async () => {
    const token = gerarToken("MUNICIPE", "municipe-status");
    const { req, res, responseHeaders } = criarReqRes({
      authorization: `Bearer ${token}`,
      url: "/analise/estacoes/status",
    });
    const next = jest.fn();

    await new Promise<void>((resolve) => {
      authOpcional(req, res, () => {
        aplicarCotaEAuditar(req, res, () => {
          next();
          resolve();
        });
      });
    });

    expect(next).toHaveBeenCalled();
    // Como a rota é isenta, não debita cota
    expect(responseHeaders["x-cota-semana-restante"]).toBeUndefined();
  });

  it("registra rastro em log estruturado (Cenário 7 da US-42)", async () => {
    const spyLog = jest.spyOn(console, "log").mockImplementation();
    const token = gerarToken("MUNICIPE", "municipe-log", "São José dos Campos");
    const { req, res } = criarReqRes({
      authorization: `Bearer ${token}`,
      url: "/analise/exportar/csv?periodo=7d",
      query: { periodo: "7d" },
    });

    await new Promise<void>((resolve) => {
      authOpcional(req, res, () => {
        aplicarCotaEAuditar(req, res, () => {
          resolve();
        });
      });
    });

    expect(spyLog).toHaveBeenCalled();
    const logChamado = spyLog.mock.calls.find((call) =>
      typeof call[0] === "string" && call[0].includes("requisicao_dados")
    );
    expect(logChamado).toBeDefined();
    const parsed = JSON.parse(logChamado![0] as string);
    expect(parsed.usuarioId).toBe("municipe-log");
    expect(parsed.papel).toBe("MUNICIPE");
    expect(parsed.rota).toContain("/analise/exportar/csv");
    expect(parsed.municipio).toBe("São José dos Campos");

    spyLog.mockRestore();
  });
});
