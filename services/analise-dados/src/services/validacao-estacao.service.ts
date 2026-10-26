import { extrairUuidEstacaoDoTopico } from "../utils/topic-parser";
import { ResultadoValidacaoEstacao } from "../models/resultado-validacao-estacao";

export class ErroConsultaEstacao extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = "ErroConsultaEstacao";
  }
}

interface OpcoesValidacao {
  token?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

// Adaptador opcional para o parser legado; a US-11 já fornece o UUID extraído.
export async function validarEstacaoDoTopico(
  topico: string,
  opcoes: OpcoesValidacao = {},
): Promise<ResultadoValidacaoEstacao> {
  const estacaoId = extrairUuidEstacaoDoTopico(topico);
  if (!estacaoId) return { valido: false, motivo: "TOPICO_INVALIDO" };
  return validarEstacaoPorId(estacaoId, opcoes);
}

// Erros de infraestrutura são lançados para permitir retry pelo consumidor.
export async function validarEstacaoPorId(
  uuid: string,
  opcoes: OpcoesValidacao = {},
): Promise<ResultadoValidacaoEstacao> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid)) {
    return { valido: false, motivo: "Estação desconhecida" };
  }
  const estacaoId = uuid.toLowerCase();

  const token = opcoes.token ?? process.env.GESTAO_ESTACOES_TOKEN;
  if (!token) throw new ErroConsultaEstacao("Token de gestão de estações não configurado");
  const baseUrl = (opcoes.baseUrl ?? process.env.GESTAO_ESTACOES_URL ??
    "http://gestao-estacoes:3000").replace(/\/$/, "");

  try {
    const response = await fetch(
      `${baseUrl}/estacoes/${encodeURIComponent(estacaoId)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(opcoes.timeoutMs ?? 5000),
      },
    );
    if (response.status === 404) {
      return { valido: false, motivo: "Estação desconhecida" };
    }
    if (!response.ok) {
      throw new ErroConsultaEstacao("Falha ao consultar gestão de estações", response.status);
    }
    const estacao: unknown = await response.json();
    if (!estacao || typeof estacao !== "object" ||
        !("id" in estacao) || typeof estacao.id !== "string" || estacao.id.toLowerCase() !== estacaoId ||
        !("status" in estacao) ||
        (estacao.status !== "Ativa" && estacao.status !== "Inativa" && estacao.status !== "Com Falha")) {
      throw new ErroConsultaEstacao("Resposta inválida de gestão de estações");
    }
    if (estacao.status === "Inativa") {
      return { valido: false, motivo: "Estação inativa" };
    }
    return { valido: true, estacaoId };
  } catch (error) {
    if (error instanceof ErroConsultaEstacao) throw error;
    throw new ErroConsultaEstacao("Erro de comunicação com gestão de estações");
  }
}
