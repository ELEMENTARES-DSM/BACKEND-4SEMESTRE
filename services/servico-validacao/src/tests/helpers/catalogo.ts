/**
 * Catálogo de grandezas (tabela tipos_sensor do gestao-estacoes) usado nos
 * testes. Os valores são os da carga inicial; NUMERIC(12,2) chega do banco como
 * texto com 2 casas, por isso as faixas estão assim.
 */
export interface GrandezaDoCatalogo {
  faixa_min: string;
  faixa_max: string;
  unidade: string;
}

export const CATALOGO: Readonly<Record<string, GrandezaDoCatalogo>> = {
  Temperatura: { faixa_min: "-50.00", faixa_max: "60.00", unidade: "°C" },
  "Umidade Relativa": { faixa_min: "0.00", faixa_max: "100.00", unidade: "%" },
  "PM2.5": { faixa_min: "0.00", faixa_max: "1000.00", unidade: "µg/m³" },
  PM10: { faixa_min: "0.00", faixa_max: "1000.00", unidade: "µg/m³" },
  "Velocidade do Vento": { faixa_min: "0.00", faixa_max: "400.00", unidade: "km/h" },
  "Direção do Vento": { faixa_min: "0.00", faixa_max: "360.00", unidade: "°" },
  Precipitação: { faixa_min: "0.00", faixa_max: "500.00", unidade: "mm" },
  "Pressão Atmosférica": { faixa_min: "600.00", faixa_max: "1100.00", unidade: "hPa" },
};

/** Faixa e unidade da grandeza; falha alto se o teste citar uma grandeza fora do catálogo. */
export function faixaDoCatalogo(tipo: string): GrandezaDoCatalogo {
  const grandeza = CATALOGO[tipo];
  if (!grandeza) {
    throw new Error(`Grandeza fora do catálogo de teste: ${tipo}`);
  }
  return grandeza;
}
