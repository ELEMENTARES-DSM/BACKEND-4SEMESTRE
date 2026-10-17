// Gerador de números aleatórios com semente (algoritmo mulberry32).
// Com a mesma semente, a sequência de números é sempre a mesma.
export type Rng = () => number;

export function criarRng(semente?: string): Rng {
  if (!semente) {
    return Math.random;
  }

  let estado = hashSemente(semente);

  return () => {
    estado = (estado + 0x6d2b79f5) | 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Transforma o texto da semente em um número inicial (FNV-1a).
function hashSemente(semente: string): number {
  let hash = 2166136261;

  for (let i = 0; i < semente.length; i++) {
    hash ^= semente.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}
