import { Request, Response, NextFunction } from "express";

export class AppError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ message: err.message });
  }

  if ((err as { type?: string }).type === "entity.parse.failed") {
    return res.status(400).json({ message: "JSON malformado." });
  }

  const code = (err as { code?: string }).code;

  // 22P02: valor com formato inválido para o tipo (ex.: uuid malformado).
  // 23514: violação de CHECK constraint.
  if (code === "22P02" || code === "23514") {
    return res.status(400).json({ message: "Dados inválidos." });
  }

  console.error(err);
  return res.status(500).json({ message: "Erro interno do servidor" });
};
