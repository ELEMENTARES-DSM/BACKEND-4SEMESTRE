import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import { AppError } from "./error-handler";
import { tokenEstaRevogado } from "../services/token-blacklist.service";

export interface AuthPayload {
  id: string;
  papel: string;
  municipio: string | null;
  jti?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

export const authenticate = async (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    throw new AppError("Token não fornecido", 401);
  }

  const token = header.slice("Bearer ".length);

  let payload: AuthPayload & JwtPayload;

  try {
    payload = jwt.verify(token, process.env.JWT_SECRET as string, {
      algorithms: ["HS256"],
    }) as AuthPayload & JwtPayload;
  } catch {
    throw new AppError("Token inválido ou expirado", 401);
  }

  if (payload.jti && (await tokenEstaRevogado(payload.jti))) {
    throw new AppError("Token inválido ou expirado", 401);
  }

  req.auth = payload;
  next();
};

export const authorize = (...papeisPermitidos: string[]) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      throw new AppError("Não autenticado", 401);
    }

    if (!papeisPermitidos.includes(req.auth.papel)) {
      throw new AppError("Acesso negado: permissão insuficiente", 403);
    }

    next();
  };
};