export const AGREGACOES_TIPO_SENSOR = ["media", "soma", "media_circular"] as const;

export type AgregacaoTipoSensor = (typeof AGREGACOES_TIPO_SENSOR)[number];

/**
 * Grandeza do catálogo (tabela tipos_sensor). As faixas voltam como texto
 * porque o driver devolve NUMERIC como string.
 */
export interface TipoSensorCatalogo {
  id: string;
  nome: string;
  unidade: string;
  faixa_min: string;
  faixa_max: string;
  agregacao: AgregacaoTipoSensor;
}
