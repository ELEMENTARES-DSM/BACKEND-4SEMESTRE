import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AppError } from "./error-handler";

export interface AuthPayload {
  id: string;
  email: string;
  papel_nome: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

export const authenticate = (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    throw new AppError("Token não fornecido", 401);
  }

  const token = header.slice("Bearer ".length);

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET as string) as AuthPayload;
    req.auth = payload;
    next();
  } catch {
    throw new AppError("Token inválido ou expirado", 401);
  }
};

export const authorize = (...papeisPermitidos: string[]) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      throw new AppError("Não autenticado", 401);
    }

    if (!papeisPermitidos.includes(req.auth.papel_nome)) {
      throw new AppError("Acesso negado: permissão insuficiente", 403);
    }

    next();
  };
};