import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { authMiddleware, checkRole } from "../../middlewares/middleware";
import * as tokenBlacklist from "../../services/token-blacklist.service";

jest.mock("jsonwebtoken");
jest.mock("../../services/token-blacklist.service");

const mockVerify = jwt.verify as jest.Mock;
const mockTokenEstaRevogado = tokenBlacklist.tokenEstaRevogado as jest.Mock;

function criarRes(): Response {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
}

describe("middlewares/middleware (gestao-usuarios)", () => {
  let next: NextFunction;

  beforeEach(() => {
    next = jest.fn();
  });

  it("deve retornar 401 quando header Authorization está ausente", async () => {
    const req = { headers: {} } as Request;
    const res = criarRes();

    await authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("deve retornar 401 quando token é revogado", async () => {
    const req = { headers: { authorization: "Bearer rev" } } as Request;
    const res = criarRes();
    mockVerify.mockReturnValue({ id: "u1", papel: "ADMINISTRADOR", municipio: null, jti: "j1" });
    mockTokenEstaRevogado.mockResolvedValue(true);

    await authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("deve retornar 401 quando jwt.verify lança Error ou valor desconhecido", async () => {
    const req = { headers: { authorization: "Bearer bad" } } as Request;
    const res1 = criarRes();
    mockVerify.mockImplementation(() => {
      throw new Error("expired");
    });
    await authMiddleware(req, res1, next);
    expect(res1.status).toHaveBeenCalledWith(401);

    const res2 = criarRes();
    mockVerify.mockImplementation(() => {
      throw "erro-string";
    });
    await authMiddleware(req, res2, next);
    expect(res2.json).toHaveBeenCalledWith({
      erro: "Token inválido ou expirado.",
      if: "Erro desconhecido",
    });
  });

  it("deve popular req.usuario e chamar next quando token é válido", async () => {
    const req = { headers: { authorization: "Bearer ok" } } as Request;
    const res = criarRes();
    mockVerify.mockReturnValue({ id: "u1", papel: "ADMINISTRADOR", municipio: null, jti: "j2" });
    mockTokenEstaRevogado.mockResolvedValue(false);

    await authMiddleware(req, res, next);

    expect(req.usuario).toEqual({ id: "u1", papel: "ADMINISTRADOR", municipio: null });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("checkRole deve responder 401 sem usuário, 403 com papel proibido e chamar next com papel permitido", () => {
    const res401 = criarRes();
    checkRole(["ADMINISTRADOR"])({} as Request, res401, next);
    expect(res401.status).toHaveBeenCalledWith(401);

    const res403 = criarRes();
    checkRole(["ADMINISTRADOR"])(
      { usuario: { id: "u1", papel: "MUNICIPE", municipio: null } } as Request,
      res403,
      next
    );
    expect(res403.status).toHaveBeenCalledWith(403);

    const resOk = criarRes();
    checkRole(["ADMINISTRADOR"])(
      { usuario: { id: "u1", papel: "ADMINISTRADOR", municipio: null } } as Request,
      resOk,
      next
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});
