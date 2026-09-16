import bcrypt from "bcrypt";
import * as userRepository from "../repositories/user.repository";
import { CreateUserDTO } from "../dto/create-user.dto";
import { UpdateUserDTO } from "../dto/update-user.dto";
import { UsuarioPublico } from "../models/user.model";
import { AppError } from "../middlewares/error-handler";

const SALT_ROUNDS = 10;

const toPublic = (usuario: Awaited<ReturnType<typeof userRepository.create>>): UsuarioPublico => {
  const { senha_hash, ...publico } = usuario;
  return publico;
};

export const create = async (data: CreateUserDTO): Promise<UsuarioPublico> => {
  const existente = await userRepository.findByEmail(data.email);
  if (existente) {
    throw new AppError("E-mail já cadastrado", 409);
  }

  const senhaHash = await bcrypt.hash(data.senha, SALT_ROUNDS);

  const usuario = await userRepository.create({
    nome: data.nome,
    email: data.email,
    senhaHash,
    papel_id: data.papel_id,
    municipio: data.municipio,
  });

  return toPublic(usuario);
};

export const findAll = async (): Promise<UsuarioPublico[]> => {
  const usuarios = await userRepository.findAll();
  return usuarios.map(toPublic);
};

export const findById = async (id: string): Promise<UsuarioPublico> => {
  const usuario = await userRepository.findById(id);
  if (!usuario) {
    throw new AppError("Usuário não encontrado", 404);
  }
  return toPublic(usuario);
};

export const update = async (
  id: string,
  data: UpdateUserDTO
): Promise<UsuarioPublico> => {
  const existente = await userRepository.findById(id);
  if (!existente) {
    throw new AppError("Usuário não encontrado", 404);
  }

  const usuario = await userRepository.update(id, data);
  return toPublic(usuario!);
};

export const remove = async (id: string): Promise<void> => {
  const existente = await userRepository.findById(id);
  if (!existente) {
    throw new AppError("Usuário não encontrado", 404);
  }

  await userRepository.softDelete(id);
};