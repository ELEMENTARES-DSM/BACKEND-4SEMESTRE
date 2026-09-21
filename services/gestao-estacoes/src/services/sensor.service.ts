import * as sensorRepository from "../repositories/sensor.repository";
import * as estacaoRepository from "../repositories/estacao.repository";
import { CreateSensorDTO } from "../dto/create-sensor.dto";
import { StatusSensor } from "../models/sensor.model";
import { AppError } from "../middlewares/error-handler";

const garantirPosseDaEstacao = async (estacaoId: string, municipioUsuario: string) => {
  const estacao = await estacaoRepository.findById(estacaoId);

  if (!estacao) {
    throw new AppError("Estação não encontrada.", 404);
  }

  if (estacao.municipio !== municipioUsuario) {
    throw new AppError(
      "Acesso negado: esta estação não pertence ao seu município.",
      403
    );
  }

  return estacao;
};

export const create = async (
  estacaoId: string,
  municipioUsuario: string,
  data: CreateSensorDTO
) => {
  await garantirPosseDaEstacao(estacaoId, municipioUsuario);

  return sensorRepository.create(estacaoId, data);
};

export const listByEstacao = async (
  estacaoId: string,
  municipioUsuario: string
) => {
  await garantirPosseDaEstacao(estacaoId, municipioUsuario);

  return sensorRepository.findByEstacaoId(estacaoId);
};

export const updateStatus = async (
  sensorId: string,
  municipioUsuario: string,
  status: StatusSensor
) => {
  const sensor = await sensorRepository.findById(sensorId);

  if (!sensor) {
    throw new AppError("Sensor não encontrado.", 404);
  }

  // A posse é da ESTAÇÃO do sensor, não do sensor em si
  await garantirPosseDaEstacao(sensor.estacao_id, municipioUsuario);

  const atualizado = await sensorRepository.updateStatus(sensorId, status);
  return atualizado!;
};