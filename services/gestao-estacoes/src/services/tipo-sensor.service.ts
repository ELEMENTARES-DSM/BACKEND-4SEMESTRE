import * as tipoSensorRepository from "../repositories/tipo-sensor.repository";
import { CreateTipoSensorDTO } from "../dto/create-tipo-sensor.dto";
import { TipoSensorCatalogo } from "../models/tipo-sensor.model";
import { AppError } from "../middlewares/error-handler";

export const listar = async (): Promise<TipoSensorCatalogo[]> => {
  return tipoSensorRepository.findAll();
};

export const criar = async (
  data: CreateTipoSensorDTO
): Promise<TipoSensorCatalogo> => {
  if (data.faixa_min >= data.faixa_max) {
    throw new AppError("faixa_min deve ser menor que faixa_max.", 400);
  }

  const existente = await tipoSensorRepository.findByNome(data.nome);
  if (existente) {
    throw new AppError(
      `Já existe uma grandeza com o nome "${data.nome}" no catálogo.`,
      409
    );
  }

  return tipoSensorRepository.create(data);
};
