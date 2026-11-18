import { Request, Response, NextFunction } from "express";

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  windowMs?: number;
  max?: number;
  message?: string;
  now?: () => number;
}

/**
 * Middleware simples de rate limiting por IP em memória.
 * Adequado para proteger endpoints pontuais contra abuso (ex: cadastro público).
 * Funciona de forma transparente com proxies reversos quando trust proxy está ativado.
 */
export const createRateLimiter = (options: RateLimitOptions = {}) => {
  const windowMs = options.windowMs ?? 60 * 60 * 1000; // 1 hora padrão
  const max = options.max ?? 5; // máximo de 5 requisições por janela
  const message =
    options.message ??
    "Limite de tentativas de cadastro excedido para este IP. Tente novamente mais tarde.";
  const getNow = options.now ?? (() => Date.now());

  const ipRecords = new Map<string, RateLimitRecord>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const now = getNow();

    const record = ipRecords.get(ip);

    if (!record || now >= record.resetAt) {
      ipRecords.set(ip, {
        count: 1,
        resetAt: now + windowMs,
      });
      res.setHeader("X-RateLimit-Limit", max);
      res.setHeader("X-RateLimit-Remaining", max - 1);
      next();
      return;
    }

    if (record.count >= max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
      res.setHeader("Retry-After", retryAfterSeconds);
      res.setHeader("X-RateLimit-Limit", max);
      res.setHeader("X-RateLimit-Remaining", 0);
      res.status(429).json({ message });
      return;
    }

    record.count += 1;
    res.setHeader("X-RateLimit-Limit", max);
    res.setHeader("X-RateLimit-Remaining", max - record.count);
    next();
  };
};

// Limiter padrão da Task 42.02: 5 cadastros por hora por IP
export const cadastroRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: "Limite de tentativas de cadastro excedido para este IP. Tente novamente mais tarde.",
});
