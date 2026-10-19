export interface EventoTelemetria {
  staging_id: string;
  estacao_uuid: string;
  unixtime: number;
  leituras: Array<{ sensor: string; valor: number }>;
}
