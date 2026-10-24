import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Formato gravado pelo modo lote do simulador-estacoes (TASK 21.01): uma linha
// JSON por mensagem publicada.
export interface LeituraLote {
  sensor: string;
  valor: number;
}

export interface MensagemLote {
  estacao_uuid: string;
  timestamp: string;
  unixtime: number;
  leituras: LeituraLote[];
  vezes: number;
  caso: string;
  payload_bruto: string;
}

/**
 * O npm roda o script na pasta deste pacote (inclusive com --prefix): o caminho
 * relativo do manifesto vale a partir de onde o npm foi chamado (INIT_CWD).
 */
export function resolverCaminhoManifesto(caminho: string, env = process.env, cwd = process.cwd()): string {
  return resolve(env.INIT_CWD ?? cwd, caminho);
}

export function lerManifesto(caminho: string): MensagemLote[] {
  const linhas = readFileSync(caminho, "utf-8")
    .split(/\r?\n/)
    .filter((linha) => linha.trim() !== "");

  if (linhas.length === 0) {
    throw new Error(`Manifesto vazio: ${caminho}`);
  }

  return linhas.map((linha, i) => {
    const m = JSON.parse(linha) as MensagemLote;
    const valida =
      typeof m.estacao_uuid === "string" &&
      Number.isInteger(m.unixtime) &&
      Array.isArray(m.leituras) &&
      m.leituras.length > 0 &&
      Number.isInteger(m.vezes) &&
      m.vezes >= 1 &&
      typeof m.payload_bruto === "string";
    if (!valida) {
      throw new Error(`Linha ${i + 1} do manifesto fora do formato do lote`);
    }
    return m;
  });
}

/** O lote seguinte começa depois do último horário deste (modo contínuo). */
export function proximoInicio(manifesto: MensagemLote[]): number {
  return Math.max(...manifesto.map((m) => m.unixtime)) + 1;
}
