import { TipoSensor } from "../models/sensor.model";

export interface UpdateSensorDTO {
  tipo: TipoSensor;
  fator?: number;
  ganho?: number;
}
