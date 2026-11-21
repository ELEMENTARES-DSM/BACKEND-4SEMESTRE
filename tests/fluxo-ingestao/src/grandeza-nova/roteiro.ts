import { createHmac } from "node:crypto";

// Peças puras do teste ponta a ponta da US-39 (grandeza nova no ar). A
// orquestração, que fala com o Docker Compose, o banco, o RabbitMQ e a API, fica
// em e2e-grandeza.ts; aqui está o que dá para testar sem nada disso.

export const SENSOR_INEXISTENTE = "Sensor inexistente na estação";

/** Evento publicado na validacao.dlq (US-18); só os campos que o roteiro usa. */
export interface EventoDlqRecusado {
  estacao_uuid: string | null;
  leituras: unknown;
  motivo: string;
}

export const topicoTelemetria = (estacaoId: string): string =>
  `pulso/estacoes/${estacaoId}/telemetria`;

/** Payload que a placa publica: uma leitura de um sensor, no horário dado. */
export function payloadTelemetria(sensor: string, valor: number, unixtime: number): string {
  return JSON.stringify({
    timestamp: new Date(unixtime * 1000).toISOString(),
    nivel_bateria: 90,
    leituras: [{ sensor, valor }],
  });
}

/** A recusa por "sensor inexistente" que carrega a leitura do sensor na estação. */
export function eventoRecusadoDoSensor(
  eventos: readonly EventoDlqRecusado[],
  estacaoId: string,
  codigoSensor: string,
): EventoDlqRecusado | undefined {
  return eventos.find(
    (evento) =>
      evento.estacao_uuid === estacaoId &&
      evento.motivo === SENSOR_INEXISTENTE &&
      Array.isArray(evento.leituras) &&
      evento.leituras.some((l) => (l as { sensor?: unknown }).sensor === codigoSensor),
  );
}

const base64url = (texto: string | Buffer): string => Buffer.from(texto).toString("base64url");

/**
 * JWT HS256 de curta duração, para o teste falar como ADMINISTRADOR com o mesmo
 * JWT_SECRET do .env, sem passar pelo login.
 */
export function assinarJwt(
  claims: Record<string, unknown>,
  segredo: string,
  agoraMs: number = Date.now(),
  validadeS = 300,
): string {
  const cabecalho = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const iat = Math.floor(agoraMs / 1000);
  const corpo = base64url(JSON.stringify({ ...claims, iat, exp: iat + validadeS }));
  const assinatura = createHmac("sha256", segredo).update(`${cabecalho}.${corpo}`).digest();
  return `${cabecalho}.${corpo}.${base64url(assinatura)}`;
}

export interface OpcoesEspera {
  limiteMs?: number;
  intervaloMs?: number;
  dormir?: (ms: number) => Promise<void>;
  relogio?: () => number;
}

/**
 * Repete a consulta até ela devolver algo (diferente de undefined, null ou
 * false) ou o tempo acabar. O erro diz o que se esperava.
 */
export async function esperarAte<T>(
  consulta: () => Promise<T | undefined | null | false>,
  rotulo: string,
  opcoes: OpcoesEspera = {},
): Promise<T> {
  const { limiteMs = 60_000, intervaloMs = 1000 } = opcoes;
  const dormir = opcoes.dormir ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const relogio = opcoes.relogio ?? Date.now;
  const limite = relogio() + limiteMs;

  for (;;) {
    const resultado = await consulta();
    if (resultado !== undefined && resultado !== null && resultado !== false) {
      return resultado;
    }
    if (relogio() >= limite) {
      throw new Error(`Tempo esgotado (${Math.round(limiteMs / 1000)} s) esperando: ${rotulo}`);
    }
    await dormir(intervaloMs);
  }
}
