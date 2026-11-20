// Brasília é UTC−3 fixo (sem horário de verão desde 2019); o dia do fim entra inteiro.
export function periodo(inicio: string, fim: string): { de: number; ate: number } {
  const de = Date.parse(`${inicio}T00:00:00-03:00`) / 1000;
  const ate = Date.parse(`${fim}T00:00:00-03:00`) / 1000 + 86400;
  return { de, ate }; // unixtime >= de AND unixtime < ate
}

// Data de hoje (AAAA-MM-DD) em Brasília, com `diasAtras` dias a menos.
export function diaEmBrasilia(diasAtras = 0): string {
  return new Date(Date.now() - 3 * 3600_000 - diasAtras * 86400_000).toISOString().slice(0, 10);
}
