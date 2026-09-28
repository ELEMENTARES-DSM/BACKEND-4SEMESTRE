import * as regraAlertaRepository from "../repositories/regra-alerta.repository";
import { CreateRegraAlertaDTO } from "../validations/regra-alerta.validation";
import { StatusRegraAlerta } from "../models/regra-alerta.model";
import { UsuarioPayload } from "../types/express";
import { AppError } from "../middlewares/error-handler";

const SENSOR_NAO_ENCONTRADO = "Sensor não encontrado.";
const REGRA_NAO_ENCONTRADA = "Regra de alerta não encontrada.";

// RN-04: faixa aceitável de valor_limite por tipo de sensor (limites inclusivos).
export const FAIXAS_VALOR_LIMITE_POR_TIPO: Record<
  string,
  { min?: number; max?: number }
> = {
  "Umidade Relativa": { min: 0, max: 100 },
  "PM2.5": { min: 0 },
  PM10: { min: 0 },
  "Velocidade do Vento": { min: 0 },
  Temperatura: { min: -90, max: 60 },
};

/**
 * RN-06/RNF-06: define o filtro territorial a partir do papel do usuário.
 * ADMINISTRADOR → null (acesso global); GESTOR_PUBLICO → município do token.
 * Gestor sem município (ou papel desconhecido) é barrado aqui, antes de
 * qualquer consulta ao banco: nenhum gestor chega ao repository com null.
 */
const resolverMunicipioDoUsuario = (usuario: UsuarioPayload): string | null => {
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

const garantirValorCoerenteComSensor = (
  tipo: string,
  unidade: string,
  valorLimite: number
) => {
  const faixa = FAIXAS_VALOR_LIMITE_POR_TIPO[tipo];
  if (!faixa) return;

  const { min, max } = faixa;
  const abaixo = min !== undefined && valorLimite < min;
  const acima = max !== undefined && valorLimite > max;

  if (!abaixo && !acima) return;

  const regra =
    min !== undefined && max !== undefined
      ? `estar entre ${min} e ${max} ${unidade}`
      : min !== undefined
        ? `ser maior ou igual a ${min} ${unidade}`
        : `ser menor ou igual a ${max} ${unidade}`;

  throw new AppError(
    `O valor limite para sensores de ${tipo} deve ${regra}.`,
    422
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

  garantirValorCoerenteComSensor(
    sensor.tipo,
    sensor.unidade_medida,
    data.valor_limite
  );

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
