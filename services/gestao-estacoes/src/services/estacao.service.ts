import * as estacaoRepository from "../repositories/estacao.repository";
import {
  ResumoStatus,
  StatusEstacoesResponse,
} from "../models/estacao.model";

export const getStatusPorMunicipio = async (
  municipio: string
): Promise<StatusEstacoesResponse> => {
  const estacoes = await estacaoRepository.findStatusByMunicipio(municipio);

  const resumo: ResumoStatus = {
    total: estacoes.length,
    ativas: 0,
    com_falha: 0,
    inativas: 0,
  };

  for (const estacao of estacoes) {
    if (estacao.status_operacional === "Ativa") resumo.ativas++;
    else if (estacao.status_operacional === "Inativa") resumo.inativas++;
    else resumo.com_falha++;
  }

  return { resumo, estacoes };
};
