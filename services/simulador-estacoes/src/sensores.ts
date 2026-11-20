import type { Rng } from "./random.js";

/**
 * Sensor como a rota interna do gestao-estacoes devolve
 * (GET /api/v1/internal/estacoes/:uuid/sensores). NUMERIC chega como texto.
 */
export interface SensorDaEstacao {
  codigo: string;
  tipo: string;
  unidade: string;
  faixa_min: string;
  faixa_max: string;
  fator_conversao: string;
  offset: string;
  status: string;
}

/** Sensor pronto para simular: a faixa física da grandeza e a calibração. */
export interface SensorSimulado {
  codigo: string;
  tipo: string;
  unidade: string;
  faixaMin: number;
  faixaMax: number;
  fatorConversao: number;
  offset: number;
}

/**
 * Faixas realistas para os dados simulados, só para a distribuição não ficar
 * absurda (PM2.5 de 900 µg/m³ a toda hora). Não é a lista de sensores nem a
 * faixa de validação: a lista vem da estação, a faixa física vem do catálogo, e
 * este valor é cortado pela faixa física. Grandeza fora desta tabela (cadastrada
 * pelo Administrador) usa a faixa física inteira, com folga nas pontas.
 */
const FAIXAS_TIPICAS: Readonly<Record<string, readonly [number, number]>> = {
  Temperatura: [15, 38],
  "Umidade Relativa": [25, 95],
  "PM2.5": [0, 150],
  PM10: [0, 200],
  "Velocidade do Vento": [0, 50],
  "Direção do Vento": [0, 360],
  Precipitação: [0, 30],
  "Pressão Atmosférica": [980, 1040],
};

const FOLGA_NAS_PONTAS = 0.05;

/**
 * Converte o sensor da API. Devolve null quando a calibração não permite gerar
 * leitura: fator zero (não dá para inverter) ou número inválido.
 */
export function converterSensor(sensor: SensorDaEstacao): SensorSimulado | null {
  const simulado: SensorSimulado = {
    codigo: sensor.codigo,
    tipo: sensor.tipo,
    unidade: sensor.unidade,
    faixaMin: Number(sensor.faixa_min),
    faixaMax: Number(sensor.faixa_max),
    fatorConversao: Number(sensor.fator_conversao),
    offset: Number(sensor.offset),
  };

  const numeros = [simulado.faixaMin, simulado.faixaMax, simulado.fatorConversao, simulado.offset];
  if (!numeros.every(Number.isFinite) || simulado.fatorConversao === 0 || simulado.faixaMin >= simulado.faixaMax) {
    return null;
  }

  return simulado;
}

const arredondar = (valor: number, casas: number): number => Number(valor.toFixed(casas));

/** Valor real que o servico-validacao grava: bruto x fator_conversao + offset, em 2 casas. */
export function calibrar(bruto: number, sensor: Pick<SensorSimulado, "fatorConversao" | "offset">): number {
  return arredondar(bruto * sensor.fatorConversao + sensor.offset, 2);
}

/**
 * Inverte a calibração: o bruto que a placa enviaria para o valor real `alvo`.
 * bruto = (alvo - offset) / fator_conversao. Sem isso, um sensor em Kelvin
 * (offset -273,15) publicaria 26,85 e a validação calcularia -246,30.
 */
export function brutoParaAlvo(
  alvo: number,
  sensor: Pick<SensorSimulado, "fatorConversao" | "offset">,
): number {
  const identidade = sensor.fatorConversao === 1 && sensor.offset === 0;
  return arredondar((alvo - sensor.offset) / sensor.fatorConversao, identidade ? 1 : 2);
}

/** Faixa em que o valor real simulado é sorteado: a típica da grandeza cortada pela física. */
export function faixaDeSorteio(sensor: SensorSimulado): readonly [number, number] {
  const folga = (sensor.faixaMax - sensor.faixaMin) * FOLGA_NAS_PONTAS;
  const fisica: readonly [number, number] = [sensor.faixaMin + folga, sensor.faixaMax - folga];
  const tipica = FAIXAS_TIPICAS[sensor.tipo];

  if (!tipica) {
    return fisica;
  }

  const minimo = Math.max(tipica[0], sensor.faixaMin);
  const maximo = Math.min(tipica[1], sensor.faixaMax);
  return minimo < maximo ? [minimo, maximo] : fisica;
}

/**
 * Sorteia o valor real dentro da faixa e devolve o bruto a publicar, já com a
 * calibração invertida. Se o arredondamento do bruto fizesse o valor real sair
 * da faixa física, usa o ponto médio da faixa.
 */
export function gerarLeituraBruta(sensor: SensorSimulado, rng: Rng = Math.random): number {
  const [minimo, maximo] = faixaDeSorteio(sensor);
  const bruto = brutoParaAlvo(minimo + rng() * (maximo - minimo), sensor);
  const real = calibrar(bruto, sensor);

  if (real >= sensor.faixaMin && real <= sensor.faixaMax) {
    return bruto;
  }

  return brutoParaAlvo((sensor.faixaMin + sensor.faixaMax) / 2, sensor);
}

/**
 * Leitura com o valor real acima da faixa física da grandeza (para o caso do
 * lote que precisa de uma medida inválida). `alvo` pode ser passado para fixar
 * o valor real, por exemplo 120 de umidade.
 */
export function gerarLeituraForaDaFaixa(sensor: SensorSimulado, alvo?: number): number {
  const real = alvo ?? sensor.faixaMax + Math.abs(sensor.faixaMax) * 0.2 + 1;
  return brutoParaAlvo(real, sensor);
}
