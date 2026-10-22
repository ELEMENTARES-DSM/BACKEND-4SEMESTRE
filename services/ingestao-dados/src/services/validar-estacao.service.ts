import { buscarStatusEstacao } from "../repositories/estacao.repository";
import {
  ESTACAO_DESCONHECIDA,
  ESTACAO_INATIVA,
} from "../validations/motivos-rejeicao";

/**
 * Conferência da estação do tópico (US-12). Retorna o motivo da rejeição ou
 * undefined quando a estação pode enviar leituras. "Com Falha" é situação
 * calculada pelo último sinal, não cadastro, então a leitura é aceita.
 * Erro de banco é propagado para a mensagem não ser confirmada ao broker.
 */
export async function conferirEstacao(
  estacaoId: string,
): Promise<string | undefined> {
  const status = await buscarStatusEstacao(estacaoId);

  if (status === null) {
    return ESTACAO_DESCONHECIDA;
  }

  if (status === "Inativa") {
    return ESTACAO_INATIVA;
  }

  return undefined;
}
