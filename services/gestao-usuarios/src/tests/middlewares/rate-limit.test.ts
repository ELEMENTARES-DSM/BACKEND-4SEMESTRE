import { createRateLimiter } from "../../middlewares/rate-limit";
import { Request, Response, NextFunction } from "express";

describe("rate-limit middleware", () => {
  const createMockReqRes = (ip: string) => {
    const req = {
      ip,
      socket: { remoteAddress: ip },
    } as unknown as Request;

    const headers: Record<string, unknown> = {};
    const res = {
      setHeader: jest.fn((k: string, v: unknown) => {
        headers[k] = v;
      }),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    } as unknown as Response;

    const next: NextFunction = jest.fn();

    return { req, res, next, headers };
  };

  it("permite requisições dentro do limite configurado", () => {
    const fakeTime = 1000;
    const limiter = createRateLimiter({
      windowMs: 60 * 1000,
      max: 5,
      now: () => fakeTime,
    });

    for (let i = 1; i <= 5; i++) {
      const { req, res, next } = createMockReqRes("192.168.1.1");
      limiter(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    }
  });

  it("bloqueia a 6ª requisição com status 429", () => {
    const fakeTime = 1000;
    const limiter = createRateLimiter({
      windowMs: 60 * 1000,
      max: 5,
      now: () => fakeTime,
    });

    for (let i = 1; i <= 5; i++) {
      const { req, res, next } = createMockReqRes("192.168.1.2");
      limiter(req, res, next);
    }

    const { req, res, next } = createMockReqRes("192.168.1.2");
    limiter(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("Limite de tentativas de cadastro excedido"),
      })
    );
  });

  it("reseta o contador quando a janela de tempo expira", () => {
    let fakeTime = 1000;
    const limiter = createRateLimiter({
      windowMs: 60 * 1000,
      max: 5,
      now: () => fakeTime,
    });

    for (let i = 1; i <= 5; i++) {
      const { req, res, next } = createMockReqRes("192.168.1.3");
      limiter(req, res, next);
    }

    // Avança o tempo além de 1 minuto (janela)
    fakeTime += 61 * 1000;

    const { req, res, next } = createMockReqRes("192.168.1.3");
    limiter(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("isola contadores entre IPs diferentes", () => {
    const fakeTime = 1000;
    const limiter = createRateLimiter({
      windowMs: 60 * 1000,
      max: 5,
      now: () => fakeTime,
    });

    // IP A atinge o limite
    for (let i = 1; i <= 5; i++) {
      const { req, res, next } = createMockReqRes("192.168.1.10");
      limiter(req, res, next);
    }

    // IP B deve conseguir fazer requisições normalmente
    const { req, res, next } = createMockReqRes("192.168.1.20");
    limiter(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
