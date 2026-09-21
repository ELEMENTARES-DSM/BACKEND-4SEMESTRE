import * as estacaoRepository from "../repositories/estacao.repository";
import { Estacoes } from "../models/estacao.model";
import { CreateEstacaoDTO } from "../dto/create-estacao.dto";
import { UpdateEstacaoDTO } from "../dto/update-estacao.dto";
import { UserContext } from "../dto/user-context.dto";
import { AppError } from "../middlewares/error-handler";


export const create = async (data: CreateEstacaoDTO): Promise<Estacoes> => {
  const existente = await estacaoRepository.findByCodigo(data.codigo);
  if (existente) {
    throw new AppError("Identificador de estação já cadastrado no sistema", 409);
  }

  if (data.latitude < -90 || data.latitude > 90 || data.longitude < -180 || data.longitude > 180) {
    throw new AppError("Coordenadas geográficas fora dos limites válidos", 400);
  }

  return estacaoRepository.create({
    codigo: data.codigo,
    nome: data.nome,
    municipio: data.municipio,
    latitude: data.latitude,
    longitude: data.longitude,
    status: data.status ?? "Ativa",
  });
};

export const findAll = async (userContext?: UserContext): Promise<Estacoes[]> => {
  if (userContext?.papel === "GESTOR_PUBLICO" && userContext.municipio) {
    return estacaoRepository.findByMunicipio(userContext.municipio);
  }

  return estacaoRepository.findAll();
};

export const findById = async (id: string): Promise<Estacoes> => {
  const estacao = await estacaoRepository.findById(id);
  if (!estacao) {
    throw new AppError("Estação meteorológica não encontrada", 404);
  }
  return estacao;
};

export const update = async (id: string, data: UpdateEstacaoDTO): Promise<Estacoes> => {
  const existente = await estacaoRepository.findById(id);
  if (!existente) {
    throw new AppError("Estação meteorológica não encontrada", 404);
  }

  if (
    (data.latitude !== undefined && (data.latitude < -90 || data.latitude > 90)) ||
    (data.longitude !== undefined && (data.longitude < -180 || data.longitude > 180))
  ) {
    throw new AppError("Coordenadas geográficas fora dos limites válidos", 400);
  }

  const atualizado = await estacaoRepository.update(id, data);
  return atualizado!;
};

export const inativar = async (id: string): Promise<Estacoes> => {
  const existente = await estacaoRepository.findById(id);
  if (!existente) {
    throw new AppError("Estação meteorológica não encontrada", 404);
  }

  const inativada = await estacaoRepository.softDelete(id);
  return inativada!;
};