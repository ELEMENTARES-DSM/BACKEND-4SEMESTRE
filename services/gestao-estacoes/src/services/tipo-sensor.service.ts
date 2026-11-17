import * as tipoSensorRepository from "../repositories/tipo-sensor.repository";
import { CreateTipoSensorDTO } from "../dto/create-tipo-sensor.dto";
import { TipoSensorCatalogo } from "../models/tipo-sensor.model";
import { AppError } from "../middlewares/error-handler";

export const listar = async (): Promise<TipoSensorCatalogo[]> => {
  return tipoSensorRepository.findAll();
};

/**
 * Busca a grandeza no catálogo pelo nome. Nome fora do catálogo: 400 com
 * mensagem clara (o cadastro de sensor não aceita grandeza que não existe).
 */
export const obterPorNome = async (
  nome: string
): Promise<TipoSensorCatalogo> => {
  const tipo = await tipoSensorRepository.findByNome(nome);

  if (!tipo) {
    throw new AppError(
      `Tipo de sensor "${nome}" não existe no catálogo de grandezas.`,
      400
    );
  }

  return tipo;
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
