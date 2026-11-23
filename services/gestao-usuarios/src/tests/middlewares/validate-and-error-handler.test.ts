import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { validate } from "../../middlewares/validate";
import { AppError, errorHandler } from "../../middlewares/error-handler";

function criarRes(): Response {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
}

describe("middlewares/validate e error-handler (gestao-usuarios)", () => {
  const schema = z.object({ nome: z.string().min(2) });

  it("validate deve retornar 400 para dados inválidos e chamar next para dados válidos", () => {
    const next = jest.fn() as NextFunction;
    const resInvalido = criarRes();
    const reqInvalido = { body: { nome: "a" } } as Request;

    validate(schema)(reqInvalido, resInvalido, next);
    expect(resInvalido.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();

    const resValido = criarRes();
    const reqValido = { body: { nome: "Maria" } } as Request;
    validate(schema, "body")(reqValido, resValido, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("errorHandler deve tratar AppError, erro 23505 (409) e erro genérico (500)", () => {
    const req = {} as Request;
    const next = jest.fn() as NextFunction;

    const resApp = criarRes();
    errorHandler(new AppError("Inválido", 422), req, resApp, next);
    expect(resApp.status).toHaveBeenCalledWith(422);

    const resDup = criarRes();
    errorHandler(Object.assign(new Error("dup"), { code: "23505" }), req, resDup, next);
    expect(resDup.status).toHaveBeenCalledWith(409);

    const res500 = criarRes();
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    errorHandler(new Error("boom"), req, res500, next);
    expect(res500.status).toHaveBeenCalledWith(500);
    spy.mockRestore();
  });
});
