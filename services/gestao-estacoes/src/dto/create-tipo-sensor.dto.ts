import { AgregacaoTipoSensor } from "../models/tipo-sensor.model";

export interface CreateTipoSensorDTO {
  nome: string;
  unidade: string;
  faixa_min: number;
  faixa_max: number;
  agregacao: AgregacaoTipoSensor;
}
