import { paraBigIntEscala6 } from "./calibracao.service";

export interface FaixaFisica {
  minimo: string;
  maximo: string;
  unidade: string;
}

/**
 * Faixas físicas fixas por grandeza (US-19), com limites inclusivos. A chave é
 * o tipo do sensor cadastrado no gestao-estacoes. O gestor não edita esses valores.
 * PM10 não estava na TASK 19.01: usa a mesma faixa do PM2.5.
 */
export const FAIXAS_FISICAS: Readonly<Record<string, FaixaFisica>> = {
  Temperatura: { minimo: "-50", maximo: "60", unidade: "°C" },
  "Umidade Relativa": { minimo: "0", maximo: "100", unidade: "%" },
  "PM2.5": { minimo: "0", maximo: "1000", unidade: "µg/m³" },
  PM10: { minimo: "0", maximo: "1000", unidade: "µg/m³" },
  "Velocidade do Vento": { minimo: "0", maximo: "400", unidade: "km/h" },
  "Direção do Vento": { minimo: "0", maximo: "360", unidade: "°" },
  Precipitação: { minimo: "0", maximo: "500", unidade: "mm" },
  "Pressão Atmosférica": { minimo: "600", maximo: "1100", unidade: "hPa" },
};

export function buscarFaixaFisica(tipo: string | undefined): FaixaFisica | undefined {
  return tipo === undefined ? undefined : FAIXAS_FISICAS[tipo];
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
