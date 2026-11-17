import { TipoSensor } from "../models/sensor.model";

export interface CreateSensorDTO {
  codigo: string;
  nome?: string;
  tipo: TipoSensor;
  unidade_leitura?: string | null;
  fator_conversao?: number;
  offset?: number;
}
