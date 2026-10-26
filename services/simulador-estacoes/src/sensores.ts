import type { Rng } from "./random.js";

export type TipoSensor =
  | "Temperatura"
  | "Umidade Relativa"
  | "PM2.5"
  | "PM10"
  | "Velocidade do Vento";

export interface SensorSimulado {
  codigo: string;
  tipo: TipoSensor;
  minimo: number;
  maximo: number;
  casasDecimais: number;
}

// Códigos ilustrativos: ajuste aos sensores do ambiente de teste.
export const SENSORES: SensorSimulado[] = [
  {
    codigo: "TEMP-01",
    tipo: "Temperatura",
    minimo: 15,
    maximo: 38,
    casasDecimais: 1,
  },
  {
    codigo: "UMID-01",
    tipo: "Umidade Relativa",
    minimo: 25,
    maximo: 95,
    casasDecimais: 1,
  },
  {
    codigo: "PM25-01",
    tipo: "PM2.5",
    minimo: 0,
    maximo: 150,
    casasDecimais: 1,
  },
  {
    codigo: "PM10-01",
    tipo: "PM10",
    minimo: 0,
    maximo: 200,
    casasDecimais: 1,
  },
  {
    codigo: "VENTO-01",
    tipo: "Velocidade do Vento",
    minimo: 0,
    maximo: 50,
    casasDecimais: 1,
  },
];

export function gerarValorSensor(
  sensor: SensorSimulado,
  rng: Rng = Math.random,
): number {
  const valor =
    sensor.minimo +
    rng() * (sensor.maximo - sensor.minimo);

  return Number(valor.toFixed(sensor.casasDecimais));
}
