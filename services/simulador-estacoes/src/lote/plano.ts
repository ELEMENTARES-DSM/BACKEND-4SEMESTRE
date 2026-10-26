import { uuidAleatorio } from "../defeitos.js";
import type { Rng } from "../random.js";
import { SENSORES, gerarValorSensor } from "../sensores.js";
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
  medidas: number;
  inicioUnix: number;
  casos: readonly CasoEspecial[];
  rng: Rng;
}

const LEITURAS_POR_MENSAGEM = SENSORES.length;

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
 * Monta as mensagens do lote: tantas quanto bastam para `medidas` leituras,
 * distribuídas entre as estações, com horários únicos por estação (1 s de
 * intervalo a partir de `inicioUnix`). Cada caso especial substitui uma
 * mensagem válida, espalhada pelo lote.
 */
export function planejarLote(opcoes: OpcoesPlano): MensagemLote[] {
  const { estacoes, medidas, inicioUnix, casos, rng } = opcoes;

  if (estacoes.length === 0) {
    throw new Error("Informe ao menos uma estação para o lote.");
  }
  if (!Number.isInteger(medidas) || medidas < LEITURAS_POR_MENSAGEM) {
    throw new Error(
      `O lote precisa de pelo menos ${LEITURAS_POR_MENSAGEM} medidas (uma mensagem).`,
    );
  }

  const total = Math.ceil(medidas / LEITURAS_POR_MENSAGEM);
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
    const unixtime = proximoHorario.get(estacaoDoLote) as number;
    proximoHorario.set(estacaoDoLote, unixtime + 1);

    const leituras = SENSORES.map((sensor) => ({
      sensor: sensor.codigo,
      valor: gerarValorSensor(sensor, rng),
    }));
    let estacao = estacaoDoLote;

    if (caso === "estacao_desconhecida") {
      estacao = uuidAleatorio(rng);
    }
    if (caso === "umidade_invalida") {
      const umidade = SENSORES.findIndex((s) => s.tipo === "Umidade Relativa");
      leituras[umidade] = { sensor: SENSORES[umidade].codigo, valor: 120.0 };
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
