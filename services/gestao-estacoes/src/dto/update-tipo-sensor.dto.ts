import { AgregacaoTipoSensor } from "../models/tipo-sensor.model";

/** Campos que o PUT pode mudar; o nome da grandeza é fixo. */
export interface UpdateTipoSensorDTO {
  unidade?: string;
  faixa_min?: number;
  faixa_max?: number;
  agregacao?: AgregacaoTipoSensor;
}
