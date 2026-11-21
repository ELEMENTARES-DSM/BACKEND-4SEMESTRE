import { Request, Response, NextFunction } from "express";
import { AppError, errorHandler } from "../../middlewares/error-handler";

function criarRes(): Response {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
}

describe("error-handler (alertas-notificacoes)", () => {
  const req = {} as Request;
  const next = jest.fn() as NextFunction;

  it("deve tratar AppError com statusCode e mensagem", () => {
    const res = criarRes();
    errorHandler(new AppError("Regra inválida", 422), req, res, next);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({ message: "Regra inválida" });
  });

  it("deve responder 400 para JSON malformado", () => {
    const res = criarRes();
    const err = Object.assign(new Error("bad json"), {
      type: "entity.parse.failed",
    });
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: "JSON malformado." });
  });

  it("deve responder 400 para erros de formato/constraint do PostgreSQL (22P02 e 23514)", () => {
    const res1 = criarRes();
    errorHandler(Object.assign(new Error("uuid"), { code: "22P02" }), req, res1, next);
    expect(res1.status).toHaveBeenCalledWith(400);

    const res2 = criarRes();
    errorHandler(Object.assign(new Error("check"), { code: "23514" }), req, res2, next);
    expect(res2.status).toHaveBeenCalledWith(400);
  });

  it("deve responder 500 para erro inesperado", () => {
    const res = criarRes();
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    errorHandler(new Error("falha inesperada"), req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    spy.mockRestore();
  });
});
