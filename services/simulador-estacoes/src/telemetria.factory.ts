import type { Rng } from "./random.js";
import { SENSORES, gerarValorSensor } from "./sensores.js";

export interface LeituraItem {
  sensor: string;
  valor: number;
}

export interface PayloadTelemetria {
  timestamp: string;
  nivel_bateria?: number;
  leituras: LeituraItem[];
}

export function gerarTelemetria(rng: Rng = Math.random): PayloadTelemetria {
  const leituras = SENSORES.map((sensor) => ({
    sensor: sensor.codigo,
    valor: gerarValorSensor(sensor, rng),
  }));

  return {
    timestamp: new Date().toISOString(),
    nivel_bateria: Math.floor(rng() * 46) + 55,
    leituras,
  };
}
