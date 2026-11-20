export interface LeituraEventoDTO {
  sensor: string;
  valor: number;
}

export interface EventoTelemetriaDTO {
  staging_id: string;
  estacao_uuid: string;
  unixtime: number;
  leituras: LeituraEventoDTO[];
}

/**
 * Evento publicado na validacao.dlx (US-18). Usa os mesmos campos do evento
 * de telemetria para poder voltar à fila sem motivo e recusado_em (US-20).
 * Em evento malformado, os campos ausentes ficam null e `leituras` guarda o
 * conteúdo original recebido.
 */
export interface EventoRecusadoDTO {
  staging_id: string | null;
  estacao_uuid: string | null;
  unixtime: number | null;
  leituras: unknown;
  motivo: string;
  recusado_em: string;
}

export interface SensorEventoRow {
  id: string;
  estacao_id: string;
  codigo: string;
  /** valor = bruto x fator_conversao + offset (NUMERIC, chega como texto). */
  fator_conversao: string;
  offset: string;
  status: string;
  tipo: string;
  /**
   * Faixa física e unidade da grandeza do sensor, lidas do catálogo
   * (tipos_sensor) na mesma consulta. NUMERIC chega como texto, o que combina
   * com a conta em decimal exato.
   */
  faixa_min: string;
  faixa_max: string;
  unidade: string;
  municipio: string;
  estacao_status: string;
}

export interface NovaMedidaInput {
  sensor_id: string;
  unixtime: number;
  valor_bruto: number | string;
  valor: number | string;
  valida?: boolean;
  staging_id: string;
  criado_em: Date;
}

export interface MedidaRow {
  id: string;
  sensor_id: string;
  unixtime: string;
  valor_bruto: string;
  valor: string;
  valida: boolean;
  staging_id: string;
  criado_em: Date | string;
}
