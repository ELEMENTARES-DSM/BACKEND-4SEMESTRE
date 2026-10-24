// Segredo dos tokens de teste: precisa existir antes de o middleware ser carregado,
// por isso este módulo é o primeiro import dos testes de rota.
process.env.JWT_SECRET = process.env.JWT_SECRET || "segredo-dos-testes-de-rota";

import { AddressInfo } from "node:net";
import { Server } from "node:http";
import jwt from "jsonwebtoken";

export interface UsuarioToken {
  id?: string;
  papel: "ADMINISTRADOR" | "GESTOR_PUBLICO" | "PESQUISADOR";
  municipio?: string | null;
}

export function token(usuario: UsuarioToken): string {
  return jwt.sign(
    { id: usuario.id ?? "usuario-teste", papel: usuario.papel, municipio: usuario.municipio ?? null },
    process.env.JWT_SECRET as string,
    { algorithm: "HS256", expiresIn: 600 }
  );
}

export async function subir(app: { listen: (porta: number, cb: () => void) => Server }) {
  const servidor = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = servidor.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  const get = async (caminho: string, usuario?: UsuarioToken) => {
    const resposta = await fetch(`${base}${caminho}`, {
      headers: usuario ? { Authorization: `Bearer ${token(usuario)}` } : {},
    });
    return { status: resposta.status, corpo: await resposta.json() };
  };

  const fechar = () => new Promise<void>((resolve) => servidor.close(() => resolve()));

  return { get, fechar };
}
