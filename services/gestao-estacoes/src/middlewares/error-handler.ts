import { Request, Response } from "express";

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
  res: Response
) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ message: err.message });
  }

  // Captura erro de chave duplicada no Postgres (código de estação existente)
  if ((err as { code?: string }).code === "23505") {
    return res.status(409).json({ message: "Identificador de estação já cadastrado no sistema" });
  }

  console.error(err);
  return res.status(500).json({ message: "Erro interno do servidor" });
};