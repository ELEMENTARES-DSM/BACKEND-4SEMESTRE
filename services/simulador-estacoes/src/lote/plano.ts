import { uuidAleatorio } from "../defeitos.js";
import type { Rng } from "../random.js";
import {
  gerarLeituraBruta,
  gerarLeituraForaDaFaixa,
  type SensorSimulado,
} from "../sensores.js";
import type { LeituraItem } from "../telemetria.factory.js";

// Casos que o lote do teste contínuo (US-21) pode incluir, um de cada.
export const CASOS_LOTE = [
  "duplicata",
  "estacao_desconhecida",
  "umidade_invalida",
  "sensor_inexistente",
] as const;

export type CasoEspecial = (typeof CASOS_LOTE)[number];
export type CasoLote = "valida" | CasoEspecial;

/** Uma linha do manifesto: o que foi publicado e quantas vezes. */
export interface MensagemLote {
  estacao_uuid: string;
  timestamp: string;
  unixtime: number;
  leituras: LeituraItem[];
  vezes: number;
  caso: CasoLote;
  payload_bruto: string;
}

export interface OpcoesPlano {
  estacoes: string[];
  /** Sensores ativos de cada estação, lidos do gestao-estacoes. */
  sensoresPorEstacao: ReadonlyMap<string, readonly SensorSimulado[]>;
  medidas: number;
  inicioUnix: number;
  casos: readonly CasoEspecial[];
  rng: Rng;
}

export function lerCasos(valor: string | undefined): CasoEspecial[] {
  if (valor === undefined) {
    return [...CASOS_LOTE];
  }

  const casos = valor
    .split(",")
    .map((caso) => caso.trim())
    .filter(Boolean);

  for (const caso of casos) {
    if (!CASOS_LOTE.includes(caso as CasoEspecial)) {
      throw new Error(
        `Caso desconhecido em LOTE_CASOS: "${caso}". Use: ${CASOS_LOTE.join(", ")}`,
      );
    }
  }

  return casos as CasoEspecial[];
}

/**
 * Quantas mensagens o lote precisa: estações em rodízio, cada mensagem com uma
 * leitura por sensor da estação, até somar `medidas` leituras.
 */
function contarMensagens(
  estacoes: string[],
  tamanhos: ReadonlyMap<string, number>,
  medidas: number,
): number {
  let leituras = 0;
  let mensagens = 0;

  while (leituras < medidas) {
    leituras += tamanhos.get(estacoes[mensagens % estacoes.length]) as number;
    mensagens += 1;
  }

  return mensagens;
}

/**
 * Monta as mensagens do lote: tantas quanto bastam para `medidas` leituras,
 * distribuídas entre as estações, com horários únicos por estação (1 s de
 * intervalo a partir de `inicioUnix`). Cada estação envia uma leitura por
 * sensor ativo dela, com o valor bruto da calibração invertida. Cada caso
 * especial substitui uma mensagem válida, espalhada pelo lote.
 */
export function planejarLote(opcoes: OpcoesPlano): MensagemLote[] {
  const { estacoes, sensoresPorEstacao, medidas, inicioUnix, casos, rng } = opcoes;

  if (estacoes.length === 0) {
    throw new Error("Informe ao menos uma estação para o lote.");
  }

  const tamanhos = new Map<string, number>();
  for (const estacao of estacoes) {
    const sensores = sensoresPorEstacao.get(estacao) ?? [];
    if (sensores.length === 0) {
      throw new Error(
        `A estação ${estacao} não tem sensor ativo com código: cadastre os sensores antes do lote.`,
      );
    }
    tamanhos.set(estacao, sensores.length);
  }

  const menorMensagem = Math.min(...tamanhos.values());
  if (!Number.isInteger(medidas) || medidas < menorMensagem) {
    throw new Error(
      `O lote precisa de pelo menos ${menorMensagem} medidas (uma mensagem).`,
    );
  }

  const total = contarMensagens(estacoes, tamanhos, medidas);
  if (casos.length >= total) {
    throw new Error("O lote é pequeno demais para os casos pedidos.");
  }

  const posicoes = new Map<number, CasoEspecial>();
  casos.forEach((caso, i) => {
    posicoes.set(Math.floor(((i + 1) * total) / (casos.length + 1)), caso);
  });

  const proximoHorario = new Map(estacoes.map((id) => [id, inicioUnix]));
  const mensagens: MensagemLote[] = [];

  for (let i = 0; i < total; i++) {
    const caso = posicoes.get(i) ?? "valida";
    const estacaoDoLote = estacoes[i % estacoes.length];
    const sensores = sensoresPorEstacao.get(estacaoDoLote) as readonly SensorSimulado[];
    const unixtime = proximoHorario.get(estacaoDoLote) as number;
    proximoHorario.set(estacaoDoLote, unixtime + 1);

    const leituras: LeituraItem[] = sensores.map((sensor) => ({
      sensor: sensor.codigo,
      valor: gerarLeituraBruta(sensor, rng),
    }));
    let estacao = estacaoDoLote;

    if (caso === "estacao_desconhecida") {
      estacao = uuidAleatorio(rng);
    }
    if (caso === "umidade_invalida") {
      // Umidade 120 (valor real); estação sem sensor de umidade usa o primeiro sensor, acima da faixa.
      const indice = Math.max(
        0,
        sensores.findIndex((s) => s.tipo === "Umidade Relativa"),
      );
      const alvo = sensores[indice].tipo === "Umidade Relativa" ? 120 : undefined;
      leituras[indice] = {
        sensor: sensores[indice].codigo,
        valor: gerarLeituraForaDaFaixa(sensores[indice], alvo),
      };
    }
    if (caso === "sensor_inexistente") {
      leituras[0] = { sensor: "SENSOR-INEXISTENTE", valor: leituras[0].valor };
    }

    const timestamp = new Date(unixtime * 1000).toISOString();
    const nivelBateria = Math.floor(rng() * 46) + 55;
    mensagens.push({
      estacao_uuid: estacao,
      timestamp,
      unixtime,
      leituras,
      vezes: caso === "duplicata" ? 2 : 1,
      caso,
      payload_bruto: JSON.stringify({ timestamp, nivel_bateria: nivelBateria, leituras }),
    });
  }

  return mensagens;
}

/** Leituras publicadas, contando as cópias das duplicatas. */
export function contarLeiturasEnviadas(mensagens: MensagemLote[]): number {
  return mensagens.reduce((soma, m) => soma + m.leituras.length * m.vezes, 0);
}
