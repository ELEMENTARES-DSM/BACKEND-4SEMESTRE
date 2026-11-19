export const PERFIS = {
  ADMINISTRADOR: "ADMINISTRADOR",
  GESTOR_PUBLICO: "GESTOR_PUBLICO",
  MUNICIPE: "MUNICIPE",
  ANONIMO: "ANONIMO",
} as const;

export type PerfilUsuario = (typeof PERFIS)[keyof typeof PERFIS];

/**
 * Tabela única de limites máximos de consulta em dias por perfil.
 * - ANONIMO: até 7 dias
 * - MUNICIPE: até 30 dias
 * - GESTOR_PUBLICO e ADMINISTRADOR: sem limite (null)
 */
export const LIMITES_DIAS_POR_PERFIL: Record<string, number | null> = {
  [PERFIS.ANONIMO]: 7,
  [PERFIS.MUNICIPE]: 30,
  [PERFIS.GESTOR_PUBLICO]: null,
  [PERFIS.ADMINISTRADOR]: null,
};

export const PERIODOS_PADRAO_DIAS: Record<string, number> = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "365d": 365,
};

const PADRAO_DIAS = /^(\d+)\s*d(ias)?$/i;
const PADRAO_HORAS = /^(\d+)\s*h(oras)?$/i;

export function validarFormatoPeriodo(
  periodo?: string,
  dataInicio?: string,
  dataFim?: string
): string | null {
  if (periodo !== undefined) {
    const p = periodo.trim().toLowerCase();
    const predefinido = p in PERIODOS_PADRAO_DIAS;
    const m = p.match(PADRAO_DIAS) ?? p.match(PADRAO_HORAS);
    if (!predefinido && (!m || parseInt(m[1], 10) < 1)) {
      return `Período "${periodo}" não reconhecido. Use 24h, 7d, 30d, 90d, 365d, uma quantidade em dias (ex.: 30d) ou em horas (ex.: 720h).`;
    }
    return null;
  }

  if (dataInicio !== undefined || dataFim !== undefined) {
    if (!dataInicio || !dataFim) return "Informe data_inicio e data_fim juntas.";
    const inicio = new Date(dataInicio).getTime();
    const fim = new Date(dataFim).getTime();
    if (Number.isNaN(inicio) || Number.isNaN(fim)) return "data_inicio ou data_fim não é uma data válida.";
    if (fim < inicio) return "data_fim não pode ser anterior a data_inicio.";
  }
  return null;
}

/**
 * Converte um período textual (ex: '24h', '7d', '30d') ou datas de início/fim em quantidade de dias.
 */
export function calcularDiasSolicitados(
  periodo?: string,
  dataInicio?: string,
  dataFim?: string
): number {
  if (periodo && PERIODOS_PADRAO_DIAS[periodo.toLowerCase()]) {
    return PERIODOS_PADRAO_DIAS[periodo.toLowerCase()];
  }

  if (periodo) {
    const matchDias = periodo.match(PADRAO_DIAS);
    if (matchDias) {
      return parseInt(matchDias[1], 10);
    }
    const matchHoras = periodo.match(PADRAO_HORAS);
    if (matchHoras) {
      return Math.ceil(parseInt(matchHoras[1], 10) / 24);
    }
  }

  if (dataInicio && dataFim) {
    const inicio = new Date(dataInicio).getTime();
    const fim = new Date(dataFim).getTime();
    if (!Number.isNaN(inicio) && !Number.isNaN(fim) && fim >= inicio) {
      const diffMs = fim - inicio;
      return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    }
  }

  // Se nada foi informado, assume período padrão de 24h (1 dia)
  return 1;
}

export function obterLimiteMaximoDias(papel?: string): number | null {
  const papelNormalizado = papel ? papel.trim().toUpperCase() : PERFIS.ANONIMO;
  if (papelNormalizado in LIMITES_DIAS_POR_PERFIL) {
    return LIMITES_DIAS_POR_PERFIL[papelNormalizado];
  }
  return LIMITES_DIAS_POR_PERFIL[PERFIS.ANONIMO];
}

export interface ResultadoValidacaoPeriodo {
  valido: boolean;
  limiteDias: number | null;
  diasSolicitados: number;
  mensagemErro?: string;
}

export function validarPeriodoPorPerfil(
  papel: string | undefined,
  diasSolicitados: number
): ResultadoValidacaoPeriodo {
  const limiteDias = obterLimiteMaximoDias(papel);

  if (limiteDias === null) {
    return {
      valido: true,
      limiteDias: null,
      diasSolicitados,
    };
  }

  if (diasSolicitados > limiteDias) {
    return {
      valido: false,
      limiteDias,
      diasSolicitados,
      mensagemErro: `Período solicitado (${diasSolicitados} dias) excede o limite permitido para o seu perfil. Período máximo permitido: ${limiteDias} dias.`,
    };
  }

  return {
    valido: true,
    limiteDias,
    diasSolicitados,
  };
}
