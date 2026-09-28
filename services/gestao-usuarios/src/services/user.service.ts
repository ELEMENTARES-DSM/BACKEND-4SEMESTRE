import bcrypt from "bcryptjs";
import * as userRepository from "../repositories/user.repository";
import * as papelRepository from "../repositories/papel.repository";
import { CreateUserDTO } from "../dto/create-user.dto";
import { UpdateUserDTO } from "../dto/update-user.dto";
import { UsuarioPublico } from "../models/user.model";
import { AppError } from "../middlewares/error-handler";

const SALT_ROUNDS = 10;

const toPublic = (usuario: Awaited<ReturnType<typeof userRepository.create>>): UsuarioPublico => {
  const { senha_hash, ...publico } = usuario;
  return publico;
};

const validarPapelEMunicipio = async (papel_id: string, municipio?: string) => {
  const papel = await papelRepository.findById(papel_id);

  if (!papel) {
    throw new AppError("papel_id inválido: papel não encontrado", 400);
  }

  if (papel.nome === "GESTOR_PUBLICO" && !municipio) {
    throw new AppError(
      "Usuário com papel GESTOR_PUBLICO exige município definido",
      400
    );
  }
};

export const create = async (data: CreateUserDTO): Promise<UsuarioPublico> => {
  const existente = await userRepository.findByEmail(data.email);
  if (existente) {
    throw new AppError("E-mail já cadastrado", 409);
  }

  await validarPapelEMunicipio(data.papel_id, data.municipio);

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

export const findAll = async () => {
  return userRepository.findAll();
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

  const papelFinal = data.papel_id ?? existente.papel_id;
  const municipioFinal = data.municipio ?? existente.municipio ?? undefined;
  await validarPapelEMunicipio(papelFinal, municipioFinal);

  const usuario = await userRepository.update(id, data);
  return toPublic(usuario!);
};

export const updateStatus = async (
  id: string,
  esta_ativo: boolean
): Promise<UsuarioPublico> => {
  const existente = await userRepository.findById(id);
  if (!existente) {
    throw new AppError("Usuário não encontrado", 404);
  }

  const usuario = await userRepository.update(id, { esta_ativo });
  return toPublic(usuario!);
};

// Soft delete, service para atualizar diretamente o campo esta_ativo para FALSE
//  mantendo, para caso necessário
export const inativar = async (id: string): Promise<void> => {
  const existente = await userRepository.findById(id);
  if (!existente) {
    throw new AppError("Usuário não encontrado", 404);
  }

  await userRepository.softDelete(id);
};

export const remove = async (id: string): Promise<void> => {
  const existente = await userRepository.findById(id);
  if (!existente) {
    throw new AppError("Usuário não encontrado", 404);
  }

  await userRepository.hardDelete(id);
};