import { SensorDetectado } from "../models/sensor.model";
import { MensagemVerificada } from "../repositories/staging-valkey.repository";

// O cadastro aceita código de 1 a 30 caracteres.
const TAMANHO_MAXIMO_CODIGO = 30;

interface Acumulado {
  total: number;
  instante: number;
  valor: number | null;
}

const eObjeto = (valor: unknown): valor is Record<string, unknown> =>
  typeof valor === "object" && valor !== null && !Array.isArray(valor);

const lerPayload = (payloadBruto: string): Record<string, unknown> | null => {
  try {
    const payload: unknown = JSON.parse(payloadBruto);
    return eObjeto(payload) ? payload : null;
  } catch {
    return null;
  }
};

/** Horário da leitura: o timestamp do payload; sem ele, o de chegada à ingestão. */
const instanteDaMensagem = (
  payload: Record<string, unknown>,
  recebidoEm: string
): number => {
  const doPayload =
    typeof payload.timestamp === "string" ? Date.parse(payload.timestamp) : NaN;

  return Number.isNaN(doPayload) ? Date.parse(recebidoEm) : doPayload;
};

/**
 * Códigos de sensor enviados nas mensagens que ainda não têm sensor cadastrado
 * na estação, do mais recente para o mais antigo.
 *
 * - `registrados` são os códigos que a estação já tem (ativos e inativos). A
 *   comparação é exata, como a da validação: `pm25` não casa com `PM25`, então o
 *   descompasso aparece na lista em vez de ficar escondido.
 * - Só entram códigos que dá para cadastrar (1 a 30 caracteres, sem espaço nas
 *   pontas): o cadastro apara o código, e um código com espaço nunca casaria.
 * - Mensagem que não é JSON, sem `leituras` ou com item mal formado é pulada: o
 *   payload é da estação, e uma mensagem estranha não pode derrubar a lista.
 * - Mensagem de antes de `desde` não conta, para não oferecer código antigo.
 */
export const agruparCodigosDetectados = (
  mensagens: MensagemVerificada[],
  registrados: Iterable<string>,
  desde: Date,
  limite: number
): SensorDetectado[] => {
  const jaCadastrados = new Set(registrados);
  const porCodigo = new Map<string, Acumulado>();

  for (const mensagem of mensagens) {
    const payload = lerPayload(mensagem.payloadBruto);
    if (!payload || !Array.isArray(payload.leituras)) continue;

    const instante = instanteDaMensagem(payload, mensagem.recebidoEm);
    if (Number.isNaN(instante) || instante < desde.getTime()) continue;

    for (const leitura of payload.leituras as unknown[]) {
      if (!eObjeto(leitura) || typeof leitura.sensor !== "string") continue;

      const codigo = leitura.sensor;
      if (
        codigo.length === 0 ||
        codigo.length > TAMANHO_MAXIMO_CODIGO ||
        codigo !== codigo.trim() ||
        jaCadastrados.has(codigo)
      ) {
        continue;
      }

      const valor =
        typeof leitura.valor === "number" && Number.isFinite(leitura.valor)
          ? leitura.valor
          : null;
      const atual = porCodigo.get(codigo);

      if (!atual) {
        porCodigo.set(codigo, { total: 1, instante, valor });
      } else {
        atual.total += 1;
        if (instante > atual.instante) {
          atual.instante = instante;
          atual.valor = valor;
        }
      }
    }
  }

  return [...porCodigo.entries()]
    .sort(
      ([codigoA, a], [codigoB, b]) =>
        b.instante - a.instante || (codigoA < codigoB ? -1 : codigoA > codigoB ? 1 : 0)
    )
    .slice(0, limite)
    .map(([codigo, acumulado]) => ({
      codigo,
      total: acumulado.total,
      ultimo_valor: acumulado.valor,
      ultima_leitura_em: new Date(acumulado.instante).toISOString(),
    }));
};
