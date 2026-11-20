import { TipoSensor } from "../models/sensor.model";

export interface UpdateSensorDTO {
  /** Só vale enquanto o sensor não tem código; depois o código fica fixo. */
  codigo?: string;
  tipo: TipoSensor;
  unidade_leitura?: string | null;
  fator_conversao?: number;
  offset?: number;
}
