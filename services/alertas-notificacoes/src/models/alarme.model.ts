export const SEVERIDADES_ALARME = ["ATENCAO", "ALERTA", "CRITICO"] as const;
export const SITUACOES_ALARME = ["aberto", "normalizado"] as const;

export type SeveridadeAlarme = (typeof SEVERIDADES_ALARME)[number];
export type SituacaoAlarme = (typeof SITUACOES_ALARME)[number];

/**
 * Alarme gravado pelo servico-validacao (US-22), lido aqui só para consulta, com
 * os nomes da regra, do sensor e da estação.
 */
export interface Alarme {
  id: string;
  regra_id: string;
  regra_nome: string | null;
  sensor_id: string;
  sensor_codigo: string | null;
  sensor_tipo: string | null;
  sensor_unidade_medida: string | null;
  estacao_id: string;
  estacao_codigo: string | null;
  estacao_nome: string | null;
  municipio: string;
  valor: number;
  operador: string;
  limite: number;
  severidade: SeveridadeAlarme;
  situacao: SituacaoAlarme;
  lido_em: string;
  criado_em: string;
  normalizado_em: string | null;
}

export interface FiltrosAlarme {
  de?: string;
  ate?: string;
  severidade?: SeveridadeAlarme;
  estacao_id?: string;
  situacao?: SituacaoAlarme;
}

export interface ResumoAlarmes {
  abertos: Record<SeveridadeAlarme, number>;
  total: number;
}
