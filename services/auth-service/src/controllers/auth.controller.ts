import { Request, Response, NextFunction } from "express";
import { loginSchema } from "../validations/auth.validation";
import * as authService from "../services/auth.service";

export const login = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const parsed = loginSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        message: "Dados inválidos.",
        erros: parsed.error.flatten().fieldErrors,
      });
    }

    const resultado = await authService.login(parsed.data);

    return res.status(200).json(resultado);
  } catch (err) {
    return next(err);
  }
};

export const logout = async (_req: Request, res: Response) => {
  // Stateless (RNF-03): nada a invalidar no servidor.
  // O client é responsável por descartar o token.
  // a rever requisitos
  return res.status(200).json({ message: "Logout realizado." });
};