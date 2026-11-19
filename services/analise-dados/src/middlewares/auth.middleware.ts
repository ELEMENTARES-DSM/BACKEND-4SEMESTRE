import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";

export const PERFIS = {
  ADMINISTRADOR: "ADMINISTRADOR",
  GESTOR_PUBLICO: "GESTOR_PUBLICO",
  PESQUISADOR: "PESQUISADOR",
  MUNICIPE: "MUNICIPE",
} as const;

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
      municipioEscopo?: string;
    }
  }
}

/**
 * Middleware que permite requisições anônimas ou autenticadas via Bearer JWT.
 * Se o header Authorization estiver ausente, a requisição segue com req.auth = undefined (Anônimo).
 * Se o header for fornecido, valida o token e popula req.auth. Se for inválido, responde 401.
 */
export function authOpcional(req: Request, res: Response, next: NextFunction) {
  const authorization = req.headers.authorization;

  if (!authorization) {
    req.auth = undefined;
    return next();
  }

  if (!authorization.startsWith("Bearer ")) {
    return res.status(401).json({
      erro: "Token não fornecido ou formato inválido.",
    });
  }

  const token = authorization.slice("Bearer ".length).trim();

  if (!token) {
    return res.status(401).json({
      erro: "Token não fornecido ou formato inválido.",
    });
  }

  const secret = process.env.JWT_SECRET;

  if (!secret) {
    return res.status(500).json({
      erro: "Configuração de autenticação indisponível.",
    });
  }

  try {
    const decoded = jwt.verify(token, secret, {
      algorithms: ["HS256"],
    });

    if (typeof decoded === "string") {
      return res.status(401).json({
        erro: "Token inválido ou expirado.",
      });
    }

    const payload = decoded as JwtPayload & Partial<AuthPayload>;

    if (
      typeof payload.id !== "string" ||
      typeof payload.papel !== "string" ||
      !(payload.municipio === null || typeof payload.municipio === "string")
    ) {
      return res.status(401).json({
        erro: "Token inválido ou expirado.",
      });
    }

    req.auth = {
      id: payload.id,
      papel: payload.papel,
      municipio: payload.municipio,
      jti: payload.jti,
    };

    return next();
  } catch {
    return res.status(401).json({
      erro: "Token inválido ou expirado.",
    });
  }
}

/**
 * Middleware obrigatório para quando a rota exigir login.
 */
export function authenticate(req: Request, res: Response, next: NextFunction) {
  authOpcional(req, res, () => {
    if (!req.auth) {
      return res.status(401).json({
        erro: "Token não fornecido ou formato inválido.",
      });
    }
    return next();
  });
}

export function authorize(...papeisPermitidos: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return res.status(401).json({
        erro: "Usuário não autenticado.",
      });
    }

    if (!papeisPermitidos.includes(req.auth.papel)) {
      return res.status(403).json({
        erro: "Acesso negado: permissão insuficiente.",
      });
    }

    return next();
  };
}
