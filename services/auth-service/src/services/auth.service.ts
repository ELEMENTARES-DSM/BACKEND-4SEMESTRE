import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { AppError } from "../middlewares/error-handler";
import { LoginInput } from "../validations/auth.validation";
import { revogarToken } from "./token-blacklist.service";
import { JwtPayload } from "jsonwebtoken";
import * as userRepository from "../repositories/user.repository";


const JWT_SECRET = process.env.JWT_SECRET as string;
const JWT_EXPIRES_IN_SECONDS = 8 * 60 * 60; // 8h — usado também pro TTL no Redis

interface LoginResult {
  token: string;
  usuario: {
    id: string;
    nome: string;
    papel: string;
    municipio: string | null;
  };
}

export const login = async ({
  email,
  senha,
}: LoginInput): Promise<LoginResult> => {
  const usuario = await userRepository.findByEmailComPapel(email);

  if (!usuario) {
    throw new AppError("Credenciais inválidas.", 401);
  }

  // Bloqueio sumário de conta inativa — checado antes da senha.
  if (!usuario.esta_ativo) {
    throw new AppError("Acesso revogado. Conta inativa.", 403);
  }

  const senhaValida = await bcrypt.compare(senha, usuario.senha_hash);

  if (!senhaValida) {
    throw new AppError("Credenciais inválidas.", 401);
  }

  const token = jwt.sign(
    {
      id: usuario.id,
      papel: usuario.papel,
      municipio: usuario.municipio,
      jti: randomUUID(),    // id único do token, usado pra revogação no logout
    },
    JWT_SECRET,
    { algorithm: "HS256", expiresIn: JWT_EXPIRES_IN_SECONDS }
  );

  return {
    token,
    usuario: {
      id: usuario.id,
      nome: usuario.nome,
      papel: usuario.papel,
      municipio: usuario.municipio,
    },
  };
};

export const logout = async (payload: JwtPayload): Promise<void> => {
  if (!payload.jti || !payload.exp) {
    // Token antigo (emitido antes da mudança) sem jti — não há o que revogar.
    return;
  }

  await revogarToken(payload.jti, payload.exp);
};