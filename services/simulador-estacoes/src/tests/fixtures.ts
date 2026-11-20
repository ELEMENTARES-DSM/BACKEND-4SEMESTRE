import type { SensorDaEstacao, SensorSimulado } from "../sensores.js";

/** Sensor como a rota interna do gestao-estacoes devolve. */
export const daApi = (
  codigo: string,
  tipo: string,
  unidade: string,
  faixaMin: number,
  faixaMax: number,
  extras: Partial<SensorDaEstacao> = {},
): SensorDaEstacao => ({
  codigo,
  tipo,
  unidade,
  faixa_min: faixaMin.toFixed(2),
  faixa_max: faixaMax.toFixed(2),
  fator_conversao: "1.000000",
  offset: "0.000000",
  status: "Ativo",
  ...extras,
});

/** Sensor já convertido para simulação. */
export const simulado = (
  codigo: string,
  tipo: string,
  unidade: string,
  faixaMin: number,
  faixaMax: number,
  extras: Partial<SensorSimulado> = {},
): SensorSimulado => ({
  codigo,
  tipo,
  unidade,
  faixaMin,
  faixaMax,
  fatorConversao: 1,
  offset: 0,
  ...extras,
});

// Os 5 sensores que as estações de teste (semente-estacoes.sql) já tinham.
export const CINCO_SENSORES: SensorSimulado[] = [
  simulado("TEMP-01", "Temperatura", "°C", -50, 60),
  simulado("UMID-01", "Umidade Relativa", "%", 0, 100),
  simulado("PM25-01", "PM2.5", "µg/m³", 0, 1000),
  simulado("PM10-01", "PM10", "µg/m³", 0, 1000),
  simulado("VENTO-01", "Velocidade do Vento", "km/h", 0, 400),
];

export const CHUVA = simulado("CHUVA-01", "Precipitação", "mm", 0, 500);
export const PRESSAO = simulado("PRES-01", "Pressão Atmosférica", "hPa", 600, 1100);
export const DIRECAO = simulado("DIR-01", "Direção do Vento", "°", 0, 360);
// Placa que envia em Kelvin: valor = bruto x 1 + (-273,15).
export const TEMPERATURA_EM_KELVIN = simulado("TEMP-K", "Temperatura", "°C", -50, 60, {
  offset: -273.15,
});
// Grandeza nova, cadastrada pelo Administrador: fora de qualquer tabela do simulador.
export const NEBULOSIDADE = simulado("NEB-01", "Nebulosidade", "oitavos", 0, 8);
