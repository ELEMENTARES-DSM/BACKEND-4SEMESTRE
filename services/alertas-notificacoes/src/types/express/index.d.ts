import "express";

export interface UsuarioPayload {
  id: string;
  papel: string;
  municipio: string | null;
}

declare global {
  namespace Express {
    interface Request {
      usuario?: UsuarioPayload;
    }
  }
}
