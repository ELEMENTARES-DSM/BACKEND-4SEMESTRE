import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET as string;

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      erro: "Autenticação necessária. Token não informado ou formato inválido.",
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;

    req.usuario = {
      id: payload.id,
      papel: payload.papel,
      municipio: payload.municipio,
    };

    return next();
  } catch (err) {
    return res.status(401).json({
      erro: "Token inválido ou expirado.",
    });
  }
}

export function checkRole(papeisPermitidos: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const usuario = req.usuario;

    if (!usuario) {
      return res.status(401).json({
        erro: "Usuário não autenticado.",
      });
    }

    if (!papeisPermitidos.includes(usuario.papel)) {
      return res.status(403).json({
        erro: "Acesso negado. Perfil insuficiente para esta ação.",
      });
    }

    return next();
  };
}