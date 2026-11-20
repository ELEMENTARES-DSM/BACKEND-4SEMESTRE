import { getValkeyClient } from "../config/valkey";
import {
  COTAS_POR_PERFIL,
  obterAnoSemanaIso,
  obterAnoMes,
  obterDataRenovacaoSemana,
  obterDataRenovacaoMes,
} from "../config/cotas";

export interface ResultadoCota {
  permitido: boolean;
  semanaRestante?: number | string;
  mesRestante?: number | string;
  renovaEm?: string;
  motivo?: "semana" | "mes";
}

// Fallback in-memory quando o Valkey não estiver acessível (ex: testes sem container)
const memoryStore = new Map<string, number>();

async function incrComTtl(chave: string, ttlSegundos: number): Promise<number> {
  const client = getValkeyClient();
  if (client.isOpen) {
    const val = await client.incr(chave);
    if (val === 1) {
      await client.expire(chave, ttlSegundos);
    }
    return val;
  }

  if (process.env.NODE_ENV !== "test") {
    throw new Error("Valkey indisponível para o controle de cota");
  }

  // Fallback em memória
  const atual = (memoryStore.get(chave) || 0) + 1;
  memoryStore.set(chave, atual);
  return atual;
}

async function decrFallback(chave: string): Promise<void> {
  const client = getValkeyClient();
  if (client.isOpen) {
    await client.decr(chave);
  } else {
    const atual = memoryStore.get(chave) || 0;
    if (atual > 0) {
      memoryStore.set(chave, atual - 1);
    }
  }
}

export async function verificarEDebitarCota(
  usuarioId: string,
  papel: string,
  data: Date = new Date()
): Promise<ResultadoCota> {
  const cotaConfig =
    papel === "GESTOR_PUBLICO" || papel === "ADMINISTRADOR"
      ? null
      : COTAS_POR_PERFIL[papel] ?? COTAS_POR_PERFIL.MUNICIPE;

  // GESTOR_PUBLICO e ADMINISTRADOR não possuem cota
  if (!cotaConfig) {
    return {
      permitido: true,
      semanaRestante: "ilimitado",
      mesRestante: "ilimitado",
    };
  }

  const semanaIso = obterAnoSemanaIso(data);
  const mesIso = obterAnoMes(data);

  const chaveSemana = `cota:${usuarioId}:semana:${semanaIso}`;
  const chaveMes = `cota:${usuarioId}:mes:${mesIso}`;

  // TTL: semana = 8 dias (691.200s); mês = 32 dias (2.764.800s)
  const ttlSemana = 8 * 24 * 60 * 60;
  const ttlMes = 32 * 24 * 60 * 60;

  const usoSemana = await incrComTtl(chaveSemana, ttlSemana);
  const usoMes = await incrComTtl(chaveMes, ttlMes);

  // Verifica se excedeu a cota semanal
  if (usoSemana > cotaConfig.semanal) {
    // Reverte o incremento
    await decrFallback(chaveSemana);
    await decrFallback(chaveMes);

    const renovaEm = obterDataRenovacaoSemana(data).toISOString();
    return {
      permitido: false,
      motivo: "semana",
      semanaRestante: 0,
      mesRestante: Math.max(0, cotaConfig.mensal - (usoMes - 1)),
      renovaEm,
    };
  }

  // Verifica se excedeu a cota mensal
  if (usoMes > cotaConfig.mensal) {
    // Reverte o incremento
    await decrFallback(chaveSemana);
    await decrFallback(chaveMes);

    const renovaEm = obterDataRenovacaoMes(data).toISOString();
    return {
      permitido: false,
      motivo: "mes",
      semanaRestante: Math.max(0, cotaConfig.semanal - (usoSemana - 1)),
      mesRestante: 0,
      renovaEm,
    };
  }

  return {
    permitido: true,
    semanaRestante: cotaConfig.semanal - usoSemana,
    mesRestante: cotaConfig.mensal - usoMes,
  };
}

export function limparMemoryStore(): void {
  memoryStore.clear();
}
