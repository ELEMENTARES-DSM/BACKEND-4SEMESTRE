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

  if ((err as { code?: string }).code === "23505") {
    return res.status(409).json({
      message: "Já existe um sensor com esse código nesta estação.",
    });
  }

  console.error(err);
  return res.status(500).json({ message: "Erro interno do servidor" });
};