import * as estacaoRepository from "../repositories/estacao.repository";
import {
  MunicipiosPublicoResponse,
  ResumoStatus,
  StatusEstacoesResponse,
} from "../models/estacao.model";

const SIGLAS_MUNICIPIOS: Record<string, string> = {
  sjc: "São José dos Campos",
  "sao jose dos campos": "São José dos Campos",
};

export const resolverMunicipio = (municipioParam: string): string => {
  const normalizado = municipioParam.trim().toLowerCase();
  return SIGLAS_MUNICIPIOS[normalizado] ?? municipioParam.trim();
};

export const listarMunicipiosPublico =
  async (): Promise<MunicipiosPublicoResponse> => {
    const municipios = await estacaoRepository.findDistinctMunicipios();
    return { municipios };
  };

export const getStatusPublicoPorMunicipio = async (
  municipioParam: string,
): Promise<StatusEstacoesResponse> => {
  const municipio = resolverMunicipio(municipioParam);
  const estacoes = await estacaoRepository.findStatusByMunicipio(municipio);

  const resumo: ResumoStatus = {
    total: estacoes.length,
    ativas: 0,
    com_falha: 0,
    inativas: 0,
  };

  for (const estacao of estacoes) {
    if (estacao.status_operacional === "Ativa") {
      resumo.ativas++;
    } else if (estacao.status_operacional === "Inativa") {
      resumo.inativas++;
    } else {
      resumo.com_falha++;
    }
  }

  return { resumo, estacoes };
};
