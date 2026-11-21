import { Request, Response, NextFunction } from "express";
import { verificarPeriodo } from "../../middlewares/periodo.middleware";

function criarRes(): Response {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
}

describe("periodo.middleware", () => {
  let next: NextFunction;

  beforeEach(() => {
    next = jest.fn();
  });

  it("deve retornar 400 quando qualquer parâmetro de período vier repetido como array", () => {
    const casos = [
      { periodo: ["24h", "7d"] },
      { data_inicio: ["2026-01-01", "2026-01-02"] },
      { data_fim: ["2026-01-01", "2026-01-02"] },
      { inicio: ["2026-01-01", "2026-01-02"] },
      { fim: ["2026-01-01", "2026-01-02"] },
    ];

    for (const query of casos) {
      const req = { query } as unknown as Request;
      const res = criarRes();

      verificarPeriodo(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        erro: "Parâmetros de período repetidos não são permitidos.",
      });
    }
    expect(next).not.toHaveBeenCalled();
  });

  it("deve retornar 400 quando o formato do período for inválido", () => {
    const req = { query: { periodo: "invalido" } } as unknown as Request;
    const res = criarRes();

    verificarPeriodo(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("deve retornar 400 quando o período exceder o limite do perfil", () => {
    const req = {
      query: { periodo: "30d" },
      auth: undefined,
    } as unknown as Request;
    const res = criarRes();

    verificarPeriodo(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        limiteMaximoDias: expect.any(Number),
        diasSolicitados: expect.any(Number),
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("deve chamar next para periodo válido, data_inicio/data_fim e inicio/fim", () => {
    const req1 = { query: { periodo: "24h" } } as unknown as Request;
    verificarPeriodo(req1, criarRes(), next);

    const req2 = {
      query: {
        data_inicio: "2026-10-01T00:00:00Z",
        data_fim: "2026-10-05T00:00:00Z",
      },
    } as unknown as Request;
    verificarPeriodo(req2, criarRes(), next);

    const req3 = {
      query: {
        inicio: "2026-10-01T00:00:00Z",
        fim: "2026-10-03T00:00:00Z",
      },
      auth: { id: "u1", papel: "ADMINISTRADOR", municipio: null },
    } as unknown as Request;
    verificarPeriodo(req3, criarRes(), next);

    expect(next).toHaveBeenCalledTimes(3);
  });
});
