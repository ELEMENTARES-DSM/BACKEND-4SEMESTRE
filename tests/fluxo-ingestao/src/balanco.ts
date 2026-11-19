import type { MensagemLote } from "./manifesto.js";

// Uma mensagem como o ingestao-dados guarda no Valkey (staging:msg:{id}, US-40).
export interface MensagemStaging {
  id: string;
  estacao_uuid: string | null;
  // recebida | pendente | encaminhada | recusada | duplicada
  status: string;
  motivo: string | null;
  payload_bruto: string;
}

export interface MedidasDoStaging {
  staging_id: string;
  validas: number;
  invalidas: number;
}

export interface EventoDlq {
  staging_id: string | null;
  leituras: unknown;
}

export interface Destinos {
  staging: MensagemStaging[];
  medidas: MedidasDoStaging[];
  dlq: EventoDlq[];
}

export interface Balanco {
  mensagens: number;
  enviadas: number;
  gravadasValidas: number;
  gravadasInvalidas: number;
  rejeitadas: number;
  rejeitadasPorMotivo: Record<string, number>;
  ignoradas: number;
  dlq: number;
  // Medidas de mensagens que ainda não saíram do Valkey (recebida ou pendente).
  emAndamento: number;
  diferenca: number;
}

const EM_ANDAMENTO = new Set(["recebida", "pendente"]);

// Evento recusado leva a leitura em `leituras`; o malformado, o evento original.
function leiturasDoEvento(evento: EventoDlq): number {
  if (Array.isArray(evento.leituras)) {
    return evento.leituras.length;
  }
  const original = evento.leituras as { leituras?: unknown } | null;
  return original && Array.isArray(original.leituras) ? original.leituras.length : 0;
}

/**
 * Fecha o balanço do lote em medidas: enviadas = gravadas (válidas e inválidas)
 * + rejeitadas + ignoradas (duplicatas) + na DLQ. Cada mensagem do manifesto é
 * procurada no Valkey pela estação e pelo conteúdo; cada cópia recebida é uma
 * mensagem lá, com o seu status.
 * As duplicadas só contam como ignoradas quando uma cópia do mesmo conteúdo
 * foi encaminhada; se todas são duplicadas, a leitura é de outro lote e esta
 * se perdeu.
 */
export function calcularBalanco(manifesto: MensagemLote[], destinos: Destinos): Balanco {
  const porConteudo = new Map<string, MensagemStaging[]>();
  for (const mensagem of destinos.staging) {
    const chave = `${mensagem.estacao_uuid}|${mensagem.payload_bruto}`;
    porConteudo.set(chave, [...(porConteudo.get(chave) ?? []), mensagem]);
  }
  const medidas = new Map(destinos.medidas.map((m) => [m.staging_id, m]));
  const dlqPorStaging = new Map<string, number>();
  for (const evento of destinos.dlq) {
    if (evento.staging_id) {
      dlqPorStaging.set(evento.staging_id, (dlqPorStaging.get(evento.staging_id) ?? 0) + leiturasDoEvento(evento));
    }
  }

  const balanco: Balanco = {
    mensagens: manifesto.length,
    enviadas: 0,
    gravadasValidas: 0,
    gravadasInvalidas: 0,
    rejeitadas: 0,
    rejeitadasPorMotivo: {},
    ignoradas: 0,
    dlq: 0,
    emAndamento: 0,
    diferenca: 0,
  };

  for (const m of manifesto) {
    const porMensagem = m.leituras.length;
    balanco.enviadas += porMensagem * m.vezes;

    const copias = porConteudo.get(`${m.estacao_uuid}|${m.payload_bruto}`) ?? [];
    if (copias.some((c) => EM_ANDAMENTO.has(c.status))) {
      balanco.emAndamento += porMensagem;
      continue;
    }

    // Recusada não passa pela checagem de duplicata: cada cópia é recusada.
    for (const copia of copias.filter((c) => c.status === "recusada").slice(0, m.vezes)) {
      balanco.rejeitadas += porMensagem;
      const motivo = copia.motivo ?? "sem motivo";
      balanco.rejeitadasPorMotivo[motivo] = (balanco.rejeitadasPorMotivo[motivo] ?? 0) + porMensagem;
    }

    const encaminhada = copias.find((c) => c.status === "encaminhada");
    if (!encaminhada) {
      continue;
    }
    const gravadas = medidas.get(encaminhada.id);
    balanco.gravadasValidas += gravadas?.validas ?? 0;
    balanco.gravadasInvalidas += gravadas?.invalidas ?? 0;
    balanco.dlq += dlqPorStaging.get(encaminhada.id) ?? 0;
    // Reentrega do QoS 1 também vira duplicada: conta até as cópias enviadas.
    const duplicadas = copias.filter((c) => c.status === "duplicada").length;
    balanco.ignoradas += porMensagem * Math.min(duplicadas, m.vezes - 1);
  }

  balanco.diferenca =
    balanco.enviadas -
    (balanco.gravadasValidas +
      balanco.gravadasInvalidas +
      balanco.rejeitadas +
      balanco.ignoradas +
      balanco.dlq);

  return balanco;
}

export function formatarBalanco(b: Balanco): string {
  const motivos = Object.entries(b.rejeitadasPorMotivo)
    .map(([motivo, n]) => `${motivo}: ${n}`)
    .join("; ");
  const linhas: Array<[string, string]> = [
    ["mensagens do lote", String(b.mensagens)],
    ["enviadas", String(b.enviadas)],
    ["gravadas (válida)", String(b.gravadasValidas)],
    ["gravadas (inválida)", String(b.gravadasInvalidas)],
    ["rejeitadas", motivos ? `${b.rejeitadas} (${motivos})` : String(b.rejeitadas)],
    ["ignoradas (duplicatas)", String(b.ignoradas)],
    ["na DLQ", String(b.dlq)],
    ["diferença", String(b.diferenca)],
  ];
  return linhas.map(([nome, valor]) => `  ${nome.padEnd(24, ".")} ${valor}`).join("\n");
}
