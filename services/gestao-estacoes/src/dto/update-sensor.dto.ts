import { TipoSensor } from "../models/sensor.model";

export interface UpdateSensorDTO {
  tipo: TipoSensor;
  unidade_leitura?: string | null;
  fator_conversao?: number;
  offset?: number;
}
