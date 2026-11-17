import * as sensorRepository from "../repositories/sensor.repository";
import * as estacaoRepository from "../repositories/estacao.repository";
import * as tipoSensorService from "./tipo-sensor.service";
import { CreateSensorDTO } from "../dto/create-sensor.dto";
import { UpdateSensorDTO } from "../dto/update-sensor.dto";
import { UserContext } from "../dto/user-context.dto";
import { StatusSensor } from "../models/sensor.model";
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

const garantirCodigoDisponivel = async (
  estacaoId: string,
  codigo: string,
  ignorarSensorId?: string
) => {
  const existente = await sensorRepository.findByEstacaoIdECodigo(
    estacaoId,
    codigo,
    ignorarSensorId
  );

  if (existente) {
    throw new AppError(
      `Já existe um sensor com o código "${codigo}" nesta estação.`,
      409
    );
  }
};

/**
 * O código é o que a placa envia no payload: mudar um código já definido
 * quebraria a configuração da placa, então ele fica fixo. O PUT só aceita
 * código para um sensor antigo que ainda não tem um, ou repetindo o atual.
 */
const garantirCodigoPodeSerDefinido = (
  sensor: { codigo: string | null },
  novoCodigo: string | undefined
) => {
  if (novoCodigo === undefined || sensor.codigo === null) {
    return;
  }

  if (novoCodigo !== sensor.codigo) {
    throw new AppError(
      "O código do sensor não pode ser alterado depois de definido.",
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
  const grandeza = await tipoSensorService.obterPorNome(data.tipo);
  await garantirTipoDisponivel(estacaoId, grandeza.nome);
  await garantirCodigoDisponivel(estacaoId, data.codigo);

  return sensorRepository.create(estacaoId, {
    codigo: data.codigo,
    nome: data.nome,
    tipo: grandeza.nome,
    unidadeMedida: grandeza.unidade,
    unidadeLeitura: data.unidade_leitura ?? null,
    fatorConversao: data.fator_conversao ?? 1.0,
    offset: data.offset ?? 0.0,
  });
};

export const listByEstacao = async (
  estacaoId: string,
  usuario: UserContext
) => {
  await garantirPosseDaEstacao(estacaoId, usuario);

  return sensorRepository.findByEstacaoId(estacaoId);
};

/**
 * Rota interna (X-Internal-Token), sem usuário: lista os sensores da estação
 * com a grandeza, a faixa física e a calibração. O simulador usa para gerar
 * leituras de qualquer grandeza do catálogo, no lugar de uma lista fixa.
 */
export const listarParaSimulador = async (estacaoUuid: string) => {
  const estacao = await estacaoRepository.findById(estacaoUuid);

  if (!estacao) {
    throw new AppError("Estação não encontrada.", 404);
  }

  return sensorRepository.findParaSimulador(estacaoUuid);
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
  const grandeza = await tipoSensorService.obterPorNome(data.tipo);
  await garantirTipoDisponivel(sensor.estacao_id, grandeza.nome, sensorId);
  garantirCodigoPodeSerDefinido(sensor, data.codigo);

  // Só um sensor sem código precisa da checagem: os outros repetem o próprio código.
  if (sensor.codigo === null && data.codigo !== undefined) {
    await garantirCodigoDisponivel(sensor.estacao_id, data.codigo, sensorId);
  }

  const atualizado = await sensorRepository.update(sensorId, {
    codigo: data.codigo,
    tipo: grandeza.nome,
    unidadeMedida: grandeza.unidade,
    unidadeLeitura: data.unidade_leitura ?? null,
    fatorConversao: data.fator_conversao ?? 1.0,
    offset: data.offset ?? 0.0,
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
