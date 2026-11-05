import { buscarEstacaoParaValidacao } from "../repositories/estacao.repository";
import {
  ESTACAO_DESCONHECIDA,
  ESTACAO_INATIVA,
  TIMESTAMP_FORA_DA_FAIXA,
} from "../validations/motivos-rejeicao";

// US-28: relógio adiantado além disso é tratado como desregulado.
export const TOLERANCIA_FUTURO_MS = 5 * 60 * 1000;

/**
 * Conferência da estação do tópico (US-12). Retorna o motivo da rejeição ou
 * undefined quando a estação pode enviar leituras. "Com Falha" é situação
 * calculada pelo último sinal, não cadastro, então a leitura é aceita.
 * Erro de banco é propagado para a mensagem não ser confirmada ao broker.
 */
export async function conferirEstacao(
  estacaoId: string,
  timestamp: string,
  recebidoEm: string,
): Promise<string | undefined> {
  const estacao = await buscarEstacaoParaValidacao(estacaoId);

  if (estacao === null) {
    return ESTACAO_DESCONHECIDA;
  }

  if (estacao.status === "Inativa") {
    return ESTACAO_INATIVA;
  }

  const lidoEm = Date.parse(timestamp);
  const cadastroEm = Math.floor(estacao.criado_em.getTime() / 1000) * 1000;
  if (
    lidoEm > Date.parse(recebidoEm) + TOLERANCIA_FUTURO_MS ||
    lidoEm < cadastroEm
  ) {
    return TIMESTAMP_FORA_DA_FAIXA;
  }

  return undefined;
}
