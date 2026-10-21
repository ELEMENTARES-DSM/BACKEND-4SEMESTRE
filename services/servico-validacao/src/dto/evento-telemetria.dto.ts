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

export interface SensorEventoRow {
  id: string;
  estacao_id: string;
  codigo: string;
  fator: string;
  ganho: string;
  status: string;
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
