import { Request, Response, NextFunction } from "express";
import { AppError, errorHandler } from "../../middlewares/error-handler";

function criarRes(): Response {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
}

describe("error-handler", () => {
  const req = {} as Request;
  const next = jest.fn() as NextFunction;

  it("deve responder com statusCode e mensagem quando err for AppError", () => {
    const res = criarRes();
    const err = new AppError("Acesso negado", 403);

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: "Acesso negado" });
  });

  it("deve usar statusCode 400 por padrão em AppError", () => {
    const err = new AppError("Requisição inválida");
    expect(err.statusCode).toBe(400);
  });

  it("deve responder 500 para erros inesperados", () => {
    const res = criarRes();
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    errorHandler(new Error("boom"), req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      message: "Erro interno do servidor",
    });
    spy.mockRestore();
  });
});
