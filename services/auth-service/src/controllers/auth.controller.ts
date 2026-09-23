import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import { loginSchema } from "../validations/auth.validation";
import * as authService from "../services/auth.service";
import { AppError } from "../middlewares/error-handler";

const JWT_SECRET = process.env.JWT_SECRET as string;

export const login = async (req: Request, res: Response, next: NextFunction) => {
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

export const logout = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new AppError("Token não informado ou formato inválido.", 401);
    }

    const token = authHeader.split(" ")[1];
    // decode (não verify) porque o authMiddleware, se aplicado antes, já validou.
    // Se logout não passa pelo authMiddleware, troque para jwt.verify abaixo.
    const payload = jwt.verify(token, JWT_SECRET, {
      algorithms: ["HS256"],
    }) as JwtPayload;

    await authService.logout(payload);

    return res.status(200).json({ message: "Logout realizado com sucesso." });
  } catch (err) {
    return next(err);
  }
};