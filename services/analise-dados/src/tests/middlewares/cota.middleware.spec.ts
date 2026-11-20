import jwt from "jsonwebtoken";
import { Request, Response } from "express";
import { authOpcional } from "../../middlewares/auth.middleware";
import * as cotaMiddleware from "../../middlewares/cota.middleware";
import * as cotaService from "../../services/cota.service";
import { COTAS_POR_PERFIL } from "../../config/cotas";

const { aplicarCotaEAuditar } = cotaMiddleware;
const { limparMemoryStore } = cotaService;

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
  const url = options.url || "/analise/estacoes/1/series";
  const path = url.split("?")[0];

  const req: Partial<Request> = {
    headers,
    originalUrl: url,
    url,
    path,
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

describe("cota.middleware (US-42)", () => {
  beforeEach(() => {
    limparMemoryStore();
  });

  it("deve não aplicar cota quando a requisição é sem token (anônima)", async () => {
    // Dado: requisição sem cabeçalho Authorization
    const { req, res, responseHeaders } = criarReqRes({});
    const next = jest.fn();

    // Quando: passa pelo authOpcional e aplicarCotaEAuditar
    authOpcional(req, res, () => {
      aplicarCotaEAuditar(req, res, next);
    });

    // Então: segue sem headers de cota
    expect(next).toHaveBeenCalled();
    expect(responseHeaders["x-cota-semana-restante"]).toBeUndefined();
  });

  it("deve injetar headers de cota restante quando o usuário é MUNICIPE autenticado", async () => {
    // Dado: token de MUNICIPE
    const token = gerarToken("MUNICIPE");
    const { req, res, responseHeaders } = criarReqRes({
      authorization: `Bearer ${token}`,
    });
    const next = jest.fn();

    // Quando: passa pelo middleware
    await new Promise<void>((resolve) => {
      authOpcional(req, res, () => {
        aplicarCotaEAuditar(req, res, () => {
          next();
          resolve();
        });
      });
    });

    // Então: injeta os dois cabeçalhos com o saldo debitado
    expect(next).toHaveBeenCalled();
    expect(responseHeaders["x-cota-semana-restante"]).toBe("1999");
    expect(responseHeaders["x-cota-mes-restante"]).toBe("5999");
  });

  it("deve responder 429 com data de renovação quando a cota semanal é esgotada", async () => {
    const limiteOriginal = COTAS_POR_PERFIL.MUNICIPE!.semanal;
    try {
      // Dado: cota semanal de 1 requisição
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

      // Quando: chega a 2ª requisição
      const req2 = criarReqRes({ authorization: `Bearer ${token}` });
      const next2 = jest.fn();
      await new Promise<void>((resolve) => {
        authOpcional(req2.req, req2.res, async () => {
          await aplicarCotaEAuditar(req2.req, req2.res, next2);
          resolve();
        });
      });

      // Então: responde 429 com renovaEm
      expect(next2).not.toHaveBeenCalled();
      expect(req2.res.statusCode).toBe(429);
      const data = (req2.res as unknown as { data: { erro: string; renovaEm: string } }).data;
      expect(data.erro).toContain("excedido");
      expect(data.renovaEm).toBeDefined();
    } finally {
      COTAS_POR_PERFIL.MUNICIPE!.semanal = limiteOriginal;
    }
  });

  it("deve responder 503 e não liberar o pedido quando o Valkey falha", async () => {
    // Dado: o controle de cota lança erro
    jest.spyOn(cotaService, "verificarEDebitarCota").mockRejectedValueOnce(new Error("valkey caiu"));
    const spyErro = jest.spyOn(console, "error").mockImplementation();
    const { req, res } = criarReqRes({ authorization: `Bearer ${gerarToken("MUNICIPE", "municipe-503")}` });
    const next = jest.fn();
    try {
      // Quando: chega um pedido com token
      await new Promise<void>((resolve) => {
        authOpcional(req, res, () => {
          aplicarCotaEAuditar(req, res, () => { next(); resolve(); });
          setImmediate(resolve);
        });
      });
      // Então: responde 503 e não segue para a rota
      expect(res.statusCode).toBe(503);
      expect(next).not.toHaveBeenCalled();
    } finally {
      spyErro.mockRestore();
    }
  });

  it("deve não debitar cota quando o caminho está em ROTAS_ISENTAS", async () => {
    // Dado: um caminho real listado na isenção
    const caminho = "/analise/status-teste";
    cotaMiddleware.ROTAS_ISENTAS.push(caminho);
    try {
      const { req, res, responseHeaders } = criarReqRes({ authorization: `Bearer ${gerarToken("MUNICIPE", "municipe-isento")}`, url: caminho });
      const next = jest.fn();
      // Quando: o pedido passa pelo middleware
      await new Promise<void>((resolve) => {
        authOpcional(req, res, () => { aplicarCotaEAuditar(req, res, () => { next(); resolve(); }); });
      });
      // Então: segue sem debitar cota
      expect(next).toHaveBeenCalled();
      expect(responseHeaders["x-cota-semana-restante"]).toBeUndefined();
    } finally {
      cotaMiddleware.ROTAS_ISENTAS.splice(cotaMiddleware.ROTAS_ISENTAS.indexOf(caminho), 1);
    }
  });

  it("deve debitar cota quando /alarmes aparece só na query string", async () => {
    // Dado: série com /alarmes na query
    const { req, res, responseHeaders } = criarReqRes({ authorization: `Bearer ${gerarToken("MUNICIPE", "municipe-query")}`, url: "/analise/estacoes/1/series?x=/alarmes" });
    const next = jest.fn();
    // Quando: o pedido passa pelo middleware
    await new Promise<void>((resolve) => {
      authOpcional(req, res, () => { aplicarCotaEAuditar(req, res, () => { next(); resolve(); }); });
    });
    // Então: é debitado normalmente
    expect(responseHeaders["x-cota-semana-restante"]).toBe("1999");
  });

  it("deve registrar rastro em log estruturado quando há requisição com token", async () => {
    // Dado: token de MUNICIPE com município e período na query
    const spyLog = jest.spyOn(console, "log").mockImplementation();
    const token = gerarToken("MUNICIPE", "municipe-log", "São José dos Campos");
    const { req, res } = criarReqRes({
      authorization: `Bearer ${token}`,
      url: "/analise/exportar/csv?periodo=7d",
      query: { periodo: "7d" },
    });

    // Quando: passa pelo middleware
    await new Promise<void>((resolve) => {
      authOpcional(req, res, () => {
        aplicarCotaEAuditar(req, res, () => {
          resolve();
        });
      });
    });

    // Então: registra JSON estruturado no log
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
    expect(parsed.periodo).toBe("7d");

    spyLog.mockRestore();
  });
});
