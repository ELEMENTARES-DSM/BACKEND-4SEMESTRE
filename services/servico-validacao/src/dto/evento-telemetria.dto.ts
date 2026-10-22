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
  fator: string;
  ganho: string;
  status: string;
  tipo: string;
  municipio: string;
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
