export interface CotaConfig {
  semanal: number;
  mensal: number;
}

export const COTAS_POR_PERFIL: Record<string, CotaConfig | null> = {
  MUNICIPE: {
    semanal: 2000,
    mensal: 6000,
  },
  GESTOR_PUBLICO: null,
  ADMINISTRADOR: null,
};

/**
 * Retorna o número da semana ISO (1 a 53) e o ano da semana ISO.
 */
export function obterAnoSemanaIso(data: Date = new Date()): string {
  const d = new Date(Date.UTC(data.getFullYear(), data.getMonth(), data.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  const weekStr = weekNo < 10 ? `0${weekNo}` : `${weekNo}`;
  return `${d.getUTCFullYear()}-W${weekStr}`;
}

/**
 * Retorna o mês no formato AAAA-MM.
 */
export function obterAnoMes(data: Date = new Date()): string {
  const ano = data.getUTCFullYear();
  const mes = data.getUTCMonth() + 1;
  const mesStr = mes < 10 ? `0${mes}` : `${mes}`;
  return `${ano}-${mesStr}`;
}

/**
 * Calcula a data de renovação da cota semanal (próxima segunda-feira às 00:00:00 UTC).
 */
export function obterDataRenovacaoSemana(data: Date = new Date()): Date {
  const d = new Date(data);
  const day = d.getUTCDay() || 7; // Domingo vira 7
  const diff = 8 - day; // dias até a próxima segunda
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Calcula a data de renovação da cota mensal (dia 1º do próximo mês às 00:00:00 UTC).
 */
export function obterDataRenovacaoMes(data: Date = new Date()): Date {
  const d = new Date(Date.UTC(data.getUTCFullYear(), data.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return d;
}
