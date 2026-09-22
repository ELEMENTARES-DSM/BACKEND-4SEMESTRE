import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { AppError } from "../middlewares/error-handler";
import { LoginInput } from "../validations/auth.validation";
import * as userRepository from "../repositories/user.repository";

const JWT_SECRET = process.env.JWT_SECRET as string;

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
    },
    JWT_SECRET,
    { expiresIn: "8h" }
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