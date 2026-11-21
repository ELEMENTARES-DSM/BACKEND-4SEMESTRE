import { buscarEstacaoParaValidacao } from "../repositories/estacao.repository";
import { logger } from "../utils/logger";
import {
  ESTACAO_DESCONHECIDA,
  ESTACAO_INATIVA,
  TIMESTAMP_FORA_DA_FAIXA,
} from "../validations/motivos-rejeicao";

// US-28: relógio adiantado além disso é tratado como desregulado.
export const TOLERANCIA_FUTURO_MS = 5 * 60 * 1000;

type CadastroEstacao = { id: string; status: string; criado_em: Date };

// Resultado da conferência: o UUID interno da estação, ou o motivo da recusa.
export type ResultadoConferencia =
  | { ok: true; estacaoId: string }
  | { ok: false; motivo: string };

// US-40 · Cenário 4: último cadastro lido com sucesso de cada estação (por MAC),
// usado só quando a consulta ao PostgreSQL falha, para o banco fora não parar a
// recepção. O Map não tem limite nem validade: são dezenas de estações e o
// cadastro muda pouco. Limitar ou expirar se o número de estações crescer muito.
const ultimoCadastro = new Map<string, CadastroEstacao>();

export function limparCadastrosConhecidos(): void {
  ultimoCadastro.clear();
}

async function buscarEstacao(macAddress: string): Promise<CadastroEstacao | null> {
  try {
    const estacao = await buscarEstacaoParaValidacao(macAddress);
    if (estacao) ultimoCadastro.set(macAddress, estacao);
    else ultimoCadastro.delete(macAddress);
    return estacao;
  } catch (erro) {
    const conhecida = ultimoCadastro.get(macAddress);
    // Estação nunca vista com o banco fora: erro temporário, a mensagem
    // continua "recebida" e é verificada de novo na próxima rodada.
    if (!conhecida) throw erro;
    logger.warn("PostgreSQL indisponível: usando o último cadastro lido da estação", {
      macAddress,
      erro: erro instanceof Error ? erro.message : String(erro),
    });
    return conhecida;
  }
}

/**
 * Conferência da estação do tópico (US-12). Resolve o MAC do tópico para o UUID
 * interno e devolve o motivo da rejeição quando a estação não pode enviar
 * leituras. "Com Falha" é situação calculada pelo último sinal, não cadastro,
 * então a leitura é aceita. Erro de banco com estação nunca vista é propagado
 * (erro temporário).
 */
export async function conferirEstacao(
  macAddress: string,
  timestamp: string,
  recebidoEm: string,
): Promise<ResultadoConferencia> {
  const estacao = await buscarEstacao(macAddress);

  if (estacao === null) {
    return { ok: false, motivo: ESTACAO_DESCONHECIDA };
  }

  if (estacao.status === "Inativa") {
    return { ok: false, motivo: ESTACAO_INATIVA };
  }

  const lidoEm = Date.parse(timestamp);
  const cadastroEm = Math.floor(estacao.criado_em.getTime() / 1000) * 1000;
  if (
    lidoEm > Date.parse(recebidoEm) + TOLERANCIA_FUTURO_MS ||
    lidoEm < cadastroEm
  ) {
    return { ok: false, motivo: TIMESTAMP_FORA_DA_FAIXA };
  }

  return { ok: true, estacaoId: estacao.id };
}
