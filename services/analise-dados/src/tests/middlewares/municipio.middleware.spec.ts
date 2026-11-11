import { Request, Response, NextFunction } from "express";
import {
  verificarMunicipio,
} from "../../middlewares/municipio.middleware";
import { PERFIS } from "../../middlewares/auth.middleware";

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

function criarRequest(
  papel: string,
  municipio: string | null,
  municipioSolicitado?: string,
) {
  return {
    auth: {
      id: "usuario-1",
      papel,
      municipio,
    },
    query: municipioSolicitado
      ? { municipio: municipioSolicitado }
      : {},
  } as unknown as Request;
}

describe("municipio.middleware", () => {
  it("Dado que o usuário não está autenticado, quando verificar o município, então deve retornar 401", () => {
    const req = {} as Request;
    const res = criarResponse();
    const next = jest.fn() as NextFunction;

    verificarMunicipio(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("Dado um Administrador sem município solicitado, quando verificar o município, então deve permitir acesso global", () => {
    const req = criarRequest(PERFIS.ADMINISTRADOR, null);
    const res = criarResponse();
    const next = jest.fn() as NextFunction;

    verificarMunicipio(req, res, next);

    expect(req.municipioEscopo).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("Dado um Administrador com município solicitado, quando verificar o município, então deve definir o escopo solicitado", () => {
    const req = criarRequest(
      PERFIS.ADMINISTRADOR,
      null,
      "municipio-2",
    );
    const res = criarResponse();
    const next = jest.fn() as NextFunction;

    verificarMunicipio(req, res, next);

    expect(req.municipioEscopo).toBe("municipio-2");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("Dado um Gestor sem município solicitado, quando verificar o município, então deve utilizar seu próprio município", () => {
    const req = criarRequest(
      PERFIS.GESTOR_PUBLICO,
      "municipio-1",
    );
    const res = criarResponse();
    const next = jest.fn() as NextFunction;

    verificarMunicipio(req, res, next);

    expect(req.municipioEscopo).toBe("municipio-1");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("Dado um Gestor solicitando seu próprio município, quando verificar o município, então deve permitir acesso", () => {
    const req = criarRequest(
      PERFIS.GESTOR_PUBLICO,
      "municipio-1",
      "municipio-1",
    );
    const res = criarResponse();
    const next = jest.fn() as NextFunction;

    verificarMunicipio(req, res, next);

    expect(req.municipioEscopo).toBe("municipio-1");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("Dado um Gestor solicitando outro município, quando verificar o município, então deve retornar 404", () => {
    const req = criarRequest(
      PERFIS.GESTOR_PUBLICO,
      "municipio-1",
      "municipio-2",
    );
    const res = criarResponse();
    const next = jest.fn() as NextFunction;

    verificarMunicipio(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  it("Dado um Gestor sem município associado, quando verificar o município, então deve retornar 403", () => {
    const req = criarRequest(
      PERFIS.GESTOR_PUBLICO,
      null,
    );
    const res = criarResponse();
    const next = jest.fn() as NextFunction;

    verificarMunicipio(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("Dado um Pesquisador, quando verificar o município, então deve permitir que a rota aplique suas permissões", () => {
    const req = criarRequest(
      PERFIS.PESQUISADOR,
      null,
    );
    const res = criarResponse();
    const next = jest.fn() as NextFunction;

    verificarMunicipio(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.municipioEscopo).toBeUndefined();
  });

  it("Dado um Munícipe, quando verificar o município, então deve permitir que a rota aplique suas permissões", () => {
    const req = criarRequest(
      PERFIS.MUNICIPE,
      null,
    );
    const res = criarResponse();
    const next = jest.fn() as NextFunction;

    verificarMunicipio(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.municipioEscopo).toBeUndefined();
  });
});
