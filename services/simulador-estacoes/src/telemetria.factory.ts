import type { Rng } from "./random.js";
import { gerarLeituraBruta, type SensorSimulado } from "./sensores.js";

export interface LeituraItem {
  sensor: string;
  valor: number;
}

export interface PayloadTelemetria {
  timestamp: string;
  nivel_bateria?: number;
  leituras: LeituraItem[];
}

/**
 * Uma leitura por sensor da estação, com o valor bruto que a placa enviaria
 * (a calibração invertida: o valor real cai dentro da faixa da grandeza).
 */
export function gerarTelemetria(
  sensores: readonly SensorSimulado[],
  rng: Rng = Math.random,
): PayloadTelemetria {
  const leituras = sensores.map((sensor) => ({
    sensor: sensor.codigo,
    valor: gerarLeituraBruta(sensor, rng),
  }));

  return {
    timestamp: new Date().toISOString(),
    nivel_bateria: Math.floor(rng() * 46) + 55,
    leituras,
  };
}
