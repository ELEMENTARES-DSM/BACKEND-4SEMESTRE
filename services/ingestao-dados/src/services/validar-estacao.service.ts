import { buscarEstacaoParaValidacao } from "../repositories/estacao.repository";
import { logger } from "../utils/logger";
import {
  ESTACAO_DESCONHECIDA,
  ESTACAO_INATIVA,
  TIMESTAMP_FORA_DA_FAIXA,
} from "../validations/motivos-rejeicao";

// US-28: relógio adiantado além disso é tratado como desregulado.
export const TOLERANCIA_FUTURO_MS = 5 * 60 * 1000;

type CadastroEstacao = { status: string; criado_em: Date };

// US-40 · Cenário 4: último cadastro lido com sucesso de cada estação, usado só
// quando a consulta ao PostgreSQL falha, para o banco fora não parar a recepção.
// ponytail: Map sem limite nem validade; são dezenas de estações e o cadastro
// muda pouco. Limitar ou expirar se o número de estações crescer muito.
const ultimoCadastro = new Map<string, CadastroEstacao>();

export function limparCadastrosConhecidos(): void {
  ultimoCadastro.clear();
}

async function buscarEstacao(estacaoId: string): Promise<CadastroEstacao | null> {
  try {
    const estacao = await buscarEstacaoParaValidacao(estacaoId);
    if (estacao) ultimoCadastro.set(estacaoId, estacao);
    else ultimoCadastro.delete(estacaoId);
    return estacao;
  } catch (erro) {
    const conhecida = ultimoCadastro.get(estacaoId);
    // Estação nunca vista com o banco fora: erro temporário, a mensagem
    // continua "recebida" e é verificada de novo na próxima rodada.
    if (!conhecida) throw erro;
    logger.warn("PostgreSQL indisponível: usando o último cadastro lido da estação", {
      estacaoId,
      erro: erro instanceof Error ? erro.message : String(erro),
    });
    return conhecida;
  }
}

/**
 * Conferência da estação do tópico (US-12). Retorna o motivo da rejeição ou
 * undefined quando a estação pode enviar leituras. "Com Falha" é situação
 * calculada pelo último sinal, não cadastro, então a leitura é aceita.
 * Erro de banco com estação nunca vista é propagado (erro temporário).
 */
export async function conferirEstacao(
  estacaoId: string,
  timestamp: string,
  recebidoEm: string,
): Promise<string | undefined> {
  const estacao = await buscarEstacao(estacaoId);

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
