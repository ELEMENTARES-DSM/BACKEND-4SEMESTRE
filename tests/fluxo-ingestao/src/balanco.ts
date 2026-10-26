import type { MensagemLote } from "./manifesto.js";

// O que o fluxo gravou para as mensagens do lote (US-21).
export interface StagingRow {
  id: string;
  estacao_uuid: string;
  unixtime: number | null;
  status: string;
  motivo_rejeicao: string | null;
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
  staging: StagingRow[];
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
  // Medidas de mensagens que ainda não saíram do staging (recebida ou pendente).
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
 * procurada no staging pela estação e horário, com o mesmo conteúdo (a
 * rejeitada, só pelo conteúdo).
 * As cópias de uma duplicata contam como ignoradas quando a primeira chegou.
 */
export function calcularBalanco(manifesto: MensagemLote[], destinos: Destinos): Balanco {
  const aceitas = new Map<string, StagingRow>();
  const rejeitadasPorConteudo = new Map<string, StagingRow[]>();
  for (const linha of destinos.staging) {
    if (linha.status === "rejeitada") {
      const chave = `${linha.estacao_uuid}|${linha.payload_bruto}`;
      rejeitadasPorConteudo.set(chave, [...(rejeitadasPorConteudo.get(chave) ?? []), linha]);
    } else {
      aceitas.set(`${linha.estacao_uuid}|${linha.unixtime}`, linha);
    }
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

    const rejeitadas = rejeitadasPorConteudo.get(`${m.estacao_uuid}|${m.payload_bruto}`) ?? [];
    if (rejeitadas.length > 0) {
      // Rejeitada não passa pela checagem de duplicata: cada cópia vira uma linha.
      for (const linha of rejeitadas.slice(0, m.vezes)) {
        balanco.rejeitadas += porMensagem;
        const motivo = linha.motivo_rejeicao ?? "sem motivo";
        balanco.rejeitadasPorMotivo[motivo] = (balanco.rejeitadasPorMotivo[motivo] ?? 0) + porMensagem;
      }
      continue;
    }

    const staging = aceitas.get(`${m.estacao_uuid}|${m.unixtime}`);
    // Mesma estação e horário com outro conteúdo é linha de outro lote: esta
    // mensagem foi descartada como duplicata e não chegou a nenhum destino.
    if (!staging || staging.payload_bruto !== m.payload_bruto) {
      continue;
    }
    if (EM_ANDAMENTO.has(staging.status)) {
      balanco.emAndamento += porMensagem;
      continue;
    }

    const gravadas = medidas.get(staging.id);
    balanco.gravadasValidas += gravadas?.validas ?? 0;
    balanco.gravadasInvalidas += gravadas?.invalidas ?? 0;
    balanco.dlq += dlqPorStaging.get(staging.id) ?? 0;
    balanco.ignoradas += porMensagem * (m.vezes - 1);
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
