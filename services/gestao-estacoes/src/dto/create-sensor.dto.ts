import { TipoSensor } from "../models/sensor.model";

export interface CreateSensorDTO {
  tipo: TipoSensor;
  fator?: number;
  ganho?: number;
}
