import { SensorEventoRow } from "../dto/evento-telemetria.dto";
import { paraBigIntEscala6 } from "./calibracao.service";

export interface FaixaFisica {
  minimo: string;
  maximo: string;
  unidade: string;
}

/**
 * Faixa física da grandeza do sensor (US-19), com limites inclusivos, vinda do
 * catálogo (tipos_sensor) na mesma consulta que traz o sensor (US-39). Não há
 * mais tabela fixa no código: o Administrador cadastra grandezas novas e muda
 * faixas, e a mudança vale para as leituras seguintes (as medidas já gravadas
 * não são reavaliadas).
 */
export function faixaDoSensor(
  sensor: Pick<SensorEventoRow, "faixa_min" | "faixa_max" | "unidade">,
): FaixaFisica {
  return {
    minimo: sensor.faixa_min,
    maximo: sensor.faixa_max,
    unidade: sensor.unidade,
  };
}

/**
 * Confere o valor real já arredondado em 2 casas (o mesmo que é gravado),
 * em decimal exato: 100.00 está dentro de 0 a 100 e 100.01 está fora.
 */
export function dentroDaFaixa(valorReal: string, faixa: FaixaFisica): boolean {
  const valor = paraBigIntEscala6(valorReal);
  return (
    valor >= paraBigIntEscala6(faixa.minimo) &&
    valor <= paraBigIntEscala6(faixa.maximo)
  );
}

export function descreverFaixa(faixa: FaixaFisica): string {
  return `${faixa.minimo} a ${faixa.maximo} ${faixa.unidade}`;
}
