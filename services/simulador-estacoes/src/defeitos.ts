import type { Rng } from "./random.js";
import type { PayloadTelemetria } from "./telemetria.factory.js";

export const TIPOS_DEFEITO = [
  "payload_malformado",
  "sem_timestamp",
  "estacao_inexistente",
  "estacao_inativa",
  "bateria_invalida",
  "duplicata",
  "sensor_inexistente",
  "valor_impossivel",
] as const;

export type TipoDefeito = (typeof TIPOS_DEFEITO)[number];

export interface MensagemSimulada {
  estacaoId: string;
  conteudo: string;
  vezes: number;
}

// SIM_TIPOS_ERRO vazio liga todos os tipos.
// Com valor, liga só os tipos listados, separados por vírgula.
export function lerTiposAtivos(valor: string | undefined): TipoDefeito[] {
  if (!valor || !valor.trim()) {
    return [...TIPOS_DEFEITO];
  }

  const tipos = valor
    .split(",")
    .map((tipo) => tipo.trim())
    .filter(Boolean);

  for (const tipo of tipos) {
    if (!TIPOS_DEFEITO.includes(tipo as TipoDefeito)) {
      throw new Error(
        `Tipo de defeito desconhecido em SIM_TIPOS_ERRO: "${tipo}". ` +
        `Use: ${TIPOS_DEFEITO.join(", ")}`,
      );
    }
  }

  return tipos as TipoDefeito[];
}

export function mensagemValida(
  estacaoId: string,
  payload: PayloadTelemetria,
): MensagemSimulada {
  return { estacaoId, conteudo: JSON.stringify(payload), vezes: 1 };
}

export function aplicarDefeito(
  tipo: TipoDefeito,
  estacaoId: string,
  payload: PayloadTelemetria,
  rng: Rng,
  estacaoInativaId?: string,
): MensagemSimulada {
  switch (tipo) {
    case "payload_malformado":
      // Corta o fim do JSON: o texto deixa de ser um JSON válido.
      return {
        estacaoId,
        conteudo: JSON.stringify(payload).slice(0, -5),
        vezes: 1,
      };

    case "sem_timestamp": {
      const { timestamp: _removido, ...semTimestamp } = payload;
      return mensagemValida(estacaoId, semTimestamp as PayloadTelemetria);
    }

    case "estacao_inexistente":
      // UUID novo, que não está cadastrado.
      return mensagemValida(uuidAleatorio(rng), payload);

    case "estacao_inativa":
      return mensagemValida(estacaoInativaId as string, payload);

    case "bateria_invalida":
      return mensagemValida(estacaoId, { ...payload, nivel_bateria: 150 });

    case "duplicata":
      // A mesma mensagem, publicada duas vezes.
      return { ...mensagemValida(estacaoId, payload), vezes: 2 };

    case "sensor_inexistente":
      return mensagemValida(estacaoId, {
        ...payload,
        leituras: [
          { sensor: "SENSOR-INEXISTENTE", valor: payload.leituras[0].valor },
          ...payload.leituras.slice(1),
        ],
      });

    case "valor_impossivel":
      // 99999 está fora da faixa física de todas as grandezas.
      return mensagemValida(estacaoId, {
        ...payload,
        leituras: [
          { sensor: payload.leituras[0].sensor, valor: 99999 },
          ...payload.leituras.slice(1),
        ],
      });
  }
}

export function uuidAleatorio(rng: Rng): string {
  const hex = Array.from({ length: 32 }, () =>
    Math.floor(rng() * 16).toString(16),
  ).join("");

  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-` +
    `a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  );
}
