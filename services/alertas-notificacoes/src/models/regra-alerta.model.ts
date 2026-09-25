export const OPERADORES_REGRA_ALERTA = [">", ">=", "<", "<=", "="] as const;
export const SEVERIDADES_REGRA_ALERTA = ["ATENCAO", "ALERTA", "CRITICO"] as const;
export const STATUS_REGRA_ALERTA = ["Ativa", "Inativa"] as const;

export type OperadorRegraAlerta = (typeof OPERADORES_REGRA_ALERTA)[number];
export type SeveridadeRegraAlerta = (typeof SEVERIDADES_REGRA_ALERTA)[number];
export type StatusRegraAlerta = (typeof STATUS_REGRA_ALERTA)[number];

export interface RegraAlerta {
  id: string;
  sensor_id: string;
  nome: string;
  operador: OperadorRegraAlerta;
  valor_limite: number;
  severidade: SeveridadeRegraAlerta;
  esta_ativo: boolean;
  criado_em: string;
}

export interface RegraAlertaDetalhada extends RegraAlerta {
  sensor_tipo: string;
  sensor_unidade_medida: string;
  estacao_id: string;
  estacao_codigo: string;
  estacao_nome: string;
  municipio: string;
}

export interface SensorComEstacao {
  id: string;
  tipo: string;
  unidade_medida: string;
  status: string;
  estacao_id: string;
  municipio: string;
}
