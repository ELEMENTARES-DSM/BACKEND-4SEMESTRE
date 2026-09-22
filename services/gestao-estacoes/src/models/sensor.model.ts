export type StatusSensor = "Ativo" | "Inativo";

export type TipoSensor =
  | "Temperatura"
  | "Umidade Relativa"
  | "PM2.5"
  | "PM10"
  | "Velocidade do Vento";

export const CATALOGO_TIPO_UNIDADE: Record<TipoSensor, string> = {
  Temperatura: "°C",
  "Umidade Relativa": "%",
  "PM2.5": "µg/m³",
  PM10: "µg/m³",
  "Velocidade do Vento": "km/h",
};

export const TIPOS_SENSOR = Object.keys(
  CATALOGO_TIPO_UNIDADE
) as TipoSensor[];

export interface Sensor {
  id: string;
  estacao_id: string;
  tipo: TipoSensor;
  unidade_medida: string;
  fator: string;
  ganho: string;
  status: StatusSensor;
  criado_em: string;
}
