import { TipoSensor } from "../models/sensor.model";

export interface CreateSensorDTO {
  codigo?: string;
  nome?: string;
  tipo: TipoSensor;
  fator?: number;
  ganho?: number;
}
