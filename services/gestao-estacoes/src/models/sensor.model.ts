export type StatusSensor = "Ativo" | "Inativo";

/**
 * Nome de uma grandeza do catálogo (tabela tipos_sensor). A lista não é mais
 * fixa: o Administrador cadastra grandezas novas sem mudar o código.
 */
export type TipoSensor = string;

/**
 * Sensor como o simulador precisa dele: o código que a placa envia, a grandeza
 * com a faixa física do catálogo e a calibração (valor = bruto x fator_conversao
 * + offset). NUMERIC chega como texto.
 */
export interface SensorParaSimulador {
  codigo: string;
  tipo: TipoSensor;
  unidade: string;
  faixa_min: string;
  faixa_max: string;
  fator_conversao: string;
  offset: string;
  status: StatusSensor;
}

/**
 * Código que a estação enviou e que ainda não tem sensor cadastrado nela. A
 * tela de cadastro oferece esses códigos para o Administrador escolher em vez de
 * digitar: o código cadastrado é cópia do que a placa manda.
 */
export interface SensorDetectado {
  codigo: string;
  /** Quantas leituras desse código chegaram na janela. */
  total: number;
  ultimo_valor: number | null;
  /** Horário da última leitura, em ISO 8601 (UTC). */
  ultima_leitura_em: string;
}

export interface Sensor {
  id: string;
  estacao_id: string;
  codigo: string | null;
  nome: string | null;
  tipo: TipoSensor;
  unidade_medida: string;
  /** Unidade em que a placa envia (ex.: K). Só informa; a conversão é do fator_conversao e do offset. */
  unidade_leitura: string | null;
  fator_conversao: string;
  /** Na tabela a coluna é offset_calibracao (OFFSET é palavra reservada do PostgreSQL). */
  offset: string;
  status: StatusSensor;
  criado_em: string;
}
