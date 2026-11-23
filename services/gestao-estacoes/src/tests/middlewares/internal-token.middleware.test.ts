import { Request, Response, NextFunction } from "express";
import { internalTokenMiddleware } from "../../middlewares/middleware";

describe("internalTokenMiddleware (X-Internal-Token)", () => {
  const tokenOriginal = process.env.INTERNAL_TOKEN;

  const criarMockReqRes = (headerToken?: string) => {
    const req = {
      header: jest.fn((name: string) =>
        name.toLowerCase() === "x-internal-token" ? headerToken : undefined,
      ),
    } as unknown as Request;

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    } as unknown as Response;

    const next: NextFunction = jest.fn();

    return { req, res, next };
  };

  beforeEach(() => {
    process.env.INTERNAL_TOKEN = "segredo-interno-teste";
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env.INTERNAL_TOKEN = tokenOriginal;
  });

  it("responde 401 quando o X-Internal-Token está ausente", () => {
    const { req, res, next } = criarMockReqRes(undefined);

    internalTokenMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      message: "Token interno ausente ou inválido.",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("responde 401 quando o X-Internal-Token está errado", () => {
    const { req, res, next } = criarMockReqRes("token-incorreto");

    internalTokenMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      message: "Token interno ausente ou inválido.",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("chama next() quando o X-Internal-Token está certo", () => {
    const { req, res, next } = criarMockReqRes("segredo-interno-teste");

    internalTokenMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
