export type OperadorRegra = ">" | ">=" | "<" | "<=" | "=";
export type SeveridadeAlarme = "ATENCAO" | "ALERTA" | "CRITICO";
export type SituacaoAlarme = "aberto" | "normalizado";

/** Regra ativa lida de regras_alerta (tabela do alertas-notificacoes, só leitura). */
export interface RegraAtivaRow {
  id: string;
  sensor_id: string;
  operador: OperadorRegra;
  valor_limite: string;
  severidade: SeveridadeAlarme;
}

/** Medida recém-gravada que entra na avaliação das regras (US-22). */
export interface MedidaParaAvaliar {
  medida_id: string;
  sensor_id: string;
  estacao_id: string;
  municipio: string;
  valor: string;
  lido_em: Date;
}

export interface NovoAlarmeInput {
  regra_id: string;
  medida_id: string;
  sensor_id: string;
  estacao_id: string;
  municipio: string;
  valor: string;
  operador: OperadorRegra;
  limite: string;
  severidade: SeveridadeAlarme;
  lido_em: Date;
  criado_em: Date;
}

export interface AlarmeRow {
  id: string;
  regra_id: string;
  medida_id: string;
  sensor_id: string;
  estacao_id: string;
  municipio: string;
  valor: string;
  operador: OperadorRegra;
  limite: string;
  severidade: SeveridadeAlarme;
  situacao: SituacaoAlarme;
  lido_em: Date;
  criado_em: Date;
}

export interface AlarmeNormalizadoRow {
  id: string;
  regra_id: string;
}
