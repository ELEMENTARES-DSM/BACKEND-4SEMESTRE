import * as alarmeRepository from "../repositories/alarme.repository";
import { FiltrosAlarme } from "../models/alarme.model";
import { UsuarioPayload } from "../types/express";
import { AppError } from "../middlewares/error-handler";
import { resolverMunicipioDoUsuario } from "./regra-alerta.service";

const ALARME_NAO_ENCONTRADO = "Alarme não encontrado.";

// US-24: GESTOR_PUBLICO vê só os alarmes do seu município; ADMINISTRADOR vê todos.
export const list = async (usuario: UsuarioPayload, filtros: FiltrosAlarme) => {
  const municipio = resolverMunicipioDoUsuario(usuario);

  return alarmeRepository.findAll(filtros, municipio);
};

/** Alarme de outro município responde como inexistente (404, mesma mensagem). */
export const findById = async (usuario: UsuarioPayload, id: string) => {
  const municipio = resolverMunicipioDoUsuario(usuario);
  const alarme = await alarmeRepository.findById(id);

  if (!alarme || (municipio !== null && alarme.municipio !== municipio)) {
    throw new AppError(ALARME_NAO_ENCONTRADO, 404);
  }

  return alarme;
};

export const resumo = async (usuario: UsuarioPayload) => {
  const municipio = resolverMunicipioDoUsuario(usuario);

  return alarmeRepository.resumoAbertos(municipio);
};
