export type StatusSensor = "Ativo" | "Inativo";

export interface Sensor {
  id: string;
  estacao_id: string;
  codigo: string;
  nome: string;
  grandeza: string;
  unidade: string;
  status: StatusSensor;
  criado_em: string;
  atualizado_em: string;
}