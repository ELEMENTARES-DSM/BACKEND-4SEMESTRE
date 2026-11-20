import * as regraAlertaRepository from "../repositories/regra-alerta.repository";
import { CreateRegraAlertaDTO } from "../validations/regra-alerta.validation";
import {
  SensorComEstacao,
  StatusRegraAlerta,
} from "../models/regra-alerta.model";
import { UsuarioPayload } from "../types/express";
import { AppError } from "../middlewares/error-handler";

const SENSOR_NAO_ENCONTRADO = "Sensor não encontrado.";
const REGRA_NAO_ENCONTRADA = "Regra de alerta não encontrada.";

/**
 * RN-06/RNF-06: define o filtro territorial a partir do papel do usuário.
 * ADMINISTRADOR → null (acesso global); GESTOR_PUBLICO → município do token.
 * Gestor sem município (ou papel desconhecido) é barrado aqui, antes de
 * qualquer consulta ao banco: nenhum gestor chega ao repository com null.
 */
export const resolverMunicipioDoUsuario = (usuario: UsuarioPayload): string | null => {
  if (usuario.papel === "ADMINISTRADOR") {
    return null;
  }

  if (usuario.papel === "GESTOR_PUBLICO") {
    if (!usuario.municipio) {
      throw new AppError(
        "Acesso negado: usuário sem município vinculado.",
        403
      );
    }

    return usuario.municipio;
  }

  throw new AppError(
    "Acesso negado. Perfil insuficiente para esta ação.",
    403
  );
};

/**
 * Recurso de outro município responde como inexistente (404, mesma mensagem),
 * para não revelar ao gestor que ele existe.
 */
const garantirAcessoAoMunicipio = (
  usuario: UsuarioPayload,
  municipioRecurso: string,
  mensagemNaoEncontrado: string
) => {
  const municipioUsuario = resolverMunicipioDoUsuario(usuario);

  if (municipioUsuario !== null && municipioUsuario !== municipioRecurso) {
    throw new AppError(mensagemNaoEncontrado, 404);
  }
};

/**
 * RN-04 (US-39): o valor limite precisa caber na faixa física da grandeza do
 * sensor, lida do catálogo (limites inclusivos). Fora da faixa responde 400:
 * é dado inválido, não um estado do sensor. Faixa e agregação que o
 * Administrador alterar valem para as regras novas; as já cadastradas seguem.
 */
const garantirValorCoerenteComSensor = (
  sensor: Pick<
    SensorComEstacao,
    "tipo" | "unidade_medida" | "faixa_min" | "faixa_max"
  >,
  valorLimite: number
) => {
  const min = Number(sensor.faixa_min);
  const max = Number(sensor.faixa_max);

  if (valorLimite >= min && valorLimite <= max) return;

  throw new AppError(
    `O valor limite para sensores de ${sensor.tipo} deve estar entre ${min} e ${max} ${sensor.unidade_medida}.`,
    400
  );
};

export const create = async (
  usuario: UsuarioPayload,
  data: CreateRegraAlertaDTO
) => {
  const sensor = await regraAlertaRepository.findSensorComEstacao(
    data.sensor_id
  );

  if (!sensor) {
    throw new AppError(SENSOR_NAO_ENCONTRADO, 404);
  }

  garantirAcessoAoMunicipio(usuario, sensor.municipio, SENSOR_NAO_ENCONTRADO);

  if (sensor.status !== "Ativo") {
    throw new AppError(
      "Não é possível criar regra de alerta para um sensor inativo.",
      422
    );
  }

  garantirValorCoerenteComSensor(sensor, data.valor_limite);

  return regraAlertaRepository.create({
    sensorId: data.sensor_id,
    nome: data.nome,
    operador: data.operador,
    valorLimite: data.valor_limite,
    severidade: data.severidade,
  });
};

export const list = async (usuario: UsuarioPayload) => {
  const municipio = resolverMunicipioDoUsuario(usuario);

  return regraAlertaRepository.findAllDetalhadas(municipio);
};

export const updateStatus = async (
  regraId: string,
  usuario: UsuarioPayload,
  status: StatusRegraAlerta
) => {
  const regra = await regraAlertaRepository.findByIdComMunicipio(regraId);

  if (!regra) {
    throw new AppError(REGRA_NAO_ENCONTRADA, 404);
  }

  garantirAcessoAoMunicipio(usuario, regra.municipio, REGRA_NAO_ENCONTRADA);

  // RN-01: não reativa regra de sensor inativo (inativar continua permitido).
  if (status === "Ativa" && regra.sensor_status !== "Ativo") {
    throw new AppError(
      "Não é possível ativar regra de um sensor inativo.",
      422
    );
  }

  const atualizada = await regraAlertaRepository.updateStatus(
    regraId,
    status === "Ativa"
  );

  if (!atualizada) {
    throw new AppError(REGRA_NAO_ENCONTRADA, 404);
  }

  return atualizada;
};
