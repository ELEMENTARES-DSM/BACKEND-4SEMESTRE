import { Request, Response, NextFunction } from "express";
import { ZodSchema } from "zod";

type Source = "body" | "params";

export const validate = (schema: ZodSchema, source: Source = "body") => {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      return res.status(400).json({
        message: "Dados inválidos",
        errors: result.error.flatten().fieldErrors,
      });
    }

    req[source] = result.data;
    next();
  };
};
