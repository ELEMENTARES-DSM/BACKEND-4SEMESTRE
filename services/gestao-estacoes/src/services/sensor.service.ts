import * as sensorRepository from "../repositories/sensor.repository";
import * as estacaoRepository from "../repositories/estacao.repository";
import { CreateSensorDTO } from "../dto/create-sensor.dto";
import { UpdateSensorDTO } from "../dto/update-sensor.dto";
import { UserContext } from "../dto/user-context.dto";
import { CATALOGO_TIPO_UNIDADE, StatusSensor } from "../models/sensor.model";
import { AppError } from "../middlewares/error-handler";

const garantirPosseDaEstacao = async (
  estacaoId: string,
  usuario: UserContext
) => {
  const estacao = await estacaoRepository.findById(estacaoId);

  if (!estacao) {
    throw new AppError("Estação não encontrada.", 404);
  }

  if (
    usuario.papel !== "ADMINISTRADOR" &&
    estacao.municipio !== usuario.municipio
  ) {
    throw new AppError(
      "Acesso negado: esta estação não pertence ao seu município.",
      403
    );
  }

  return estacao;
};

const garantirTipoDisponivel = async (
  estacaoId: string,
  tipo: CreateSensorDTO["tipo"],
  ignorarSensorId?: string
) => {
  const existente = await sensorRepository.findByEstacaoIdETipo(
    estacaoId,
    tipo,
    ignorarSensorId
  );

  if (existente) {
    throw new AppError(
      `Esta estação já possui um sensor de ${tipo} cadastrado`,
      409
    );
  }
};

export const create = async (
  estacaoId: string,
  usuario: UserContext,
  data: CreateSensorDTO
) => {
  await garantirPosseDaEstacao(estacaoId, usuario);
  await garantirTipoDisponivel(estacaoId, data.tipo);

  return sensorRepository.create(estacaoId, {
    codigo: data.codigo,
    nome: data.nome,
    tipo: data.tipo,
    unidadeMedida: CATALOGO_TIPO_UNIDADE[data.tipo],
    fator: data.fator ?? 1.0,
    ganho: data.ganho ?? 0.0,
  });
};

export const listByEstacao = async (
  estacaoId: string,
  usuario: UserContext
) => {
  await garantirPosseDaEstacao(estacaoId, usuario);

  return sensorRepository.findByEstacaoId(estacaoId);
};

export const update = async (
  sensorId: string,
  usuario: UserContext,
  data: UpdateSensorDTO
) => {
  const sensor = await sensorRepository.findById(sensorId);

  if (!sensor) {
    throw new AppError("Sensor não encontrado.", 404);
  }

  await garantirPosseDaEstacao(sensor.estacao_id, usuario);
  await garantirTipoDisponivel(sensor.estacao_id, data.tipo, sensorId);

  const atualizado = await sensorRepository.update(sensorId, {
    tipo: data.tipo,
    unidadeMedida: CATALOGO_TIPO_UNIDADE[data.tipo],
    fator: data.fator ?? 1.0,
    ganho: data.ganho ?? 0.0,
  });

  return atualizado!;
};

export const updateStatus = async (
  sensorId: string,
  usuario: UserContext,
  status: StatusSensor
) => {
  const sensor = await sensorRepository.findById(sensorId);

  if (!sensor) {
    throw new AppError("Sensor não encontrado.", 404);
  }

  await garantirPosseDaEstacao(sensor.estacao_id, usuario);

  const atualizado = await sensorRepository.updateStatus(sensorId, status);
  return atualizado!;
};
