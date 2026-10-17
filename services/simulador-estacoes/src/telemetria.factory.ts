
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

export function gerarTelemetria(): PayloadTelemetria {
  const leituras = SENSORES.map((sensor) => ({
    sensor: sensor.codigo,
    valor: gerarValorSensor(sensor),
  }));

  return {
    timestamp: new Date().toISOString(),
    nivel_bateria: Math.floor(Math.random() * 46) + 55,
    leituras,
  };
}
