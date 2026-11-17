export type StatusSensor = "Ativo" | "Inativo";

/**
 * Nome de uma grandeza do catálogo (tabela tipos_sensor). A lista não é mais
 * fixa: o Administrador cadastra grandezas novas sem mudar o código.
 */
export type TipoSensor = string;

export interface Sensor {
  id: string;
  estacao_id: string;
  codigo: string | null;
  nome: string | null;
  tipo: TipoSensor;
  unidade_medida: string;
  /** Unidade em que a placa envia (ex.: K). Só informa; a conversão é do fator e do offset. */
  unidade_leitura: string | null;
  fator: string;
  ganho: string;
  status: StatusSensor;
  criado_em: string;
}
