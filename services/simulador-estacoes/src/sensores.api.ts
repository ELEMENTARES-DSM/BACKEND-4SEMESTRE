import {
  converterSensor,
  type SensorDaEstacao,
  type SensorSimulado,
} from "./sensores.js";

export interface ConfigApi {
  url: string;
  tokenInterno: string;
}

const URL_PADRAO = "http://gestao-estacoes:3000";
const TEMPO_LIMITE_MS = 5000;

/**
 * SIM_API_URL é o endereço do gestao-estacoes; INTERNAL_TOKEN é o token da rota
 * interna (o mesmo do .env do backend). Sem o token o simulador não sobe: não
 * há lista fixa de sensores para usar no lugar.
 */
export function lerConfigApi(env: NodeJS.ProcessEnv = process.env): ConfigApi {
  const tokenInterno = env.INTERNAL_TOKEN?.trim();

  if (!tokenInterno) {
    throw new Error(
      "Configure INTERNAL_TOKEN (o mesmo do backend): o simulador lê os sensores " +
        "da estação na rota interna do gestao-estacoes.",
    );
  }

  const url = (env.SIM_API_URL?.trim() || URL_PADRAO).replace(/\/+$/, "");
  return { url, tokenInterno };
}

type Buscar = typeof fetch;

const MAC_VALIDO = /^[0-9a-f]{12}$/;

/**
 * MAC da estação (12 hex minúsculos), que é o identificador do tópico MQTT
 * pulso/estacoes/<mac>/telemetria. Vem do cadastro no gestao-estacoes, pelo UUID.
 */
export async function buscarMacDaEstacao(
  estacaoId: string,
  config: ConfigApi,
  buscar: Buscar = fetch,
): Promise<string> {
  const resposta = await buscar(
    `${config.url}/api/v1/internal/estacoes/${encodeURIComponent(estacaoId)}`,
    {
      headers: { "X-Internal-Token": config.tokenInterno },
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    },
  );

  if (!resposta.ok) {
    throw new Error(
      `gestao-estacoes respondeu ${resposta.status} ao buscar a estação ${estacaoId}.`,
    );
  }

  const corpo = (await resposta.json()) as { mac_address?: unknown };
  if (typeof corpo.mac_address !== "string" || !MAC_VALIDO.test(corpo.mac_address)) {
    throw new Error(`Estação ${estacaoId} sem MAC cadastrado: não há tópico para publicar.`);
  }

  return corpo.mac_address;
}

/**
 * MACs já lidos antes (LOTE_MACS_JSON), para o modo lote com o gestao-estacoes
 * fora do ar. Formato: { "<uuid da estação>": "<mac>" }.
 */
export function lerMacsDeJson(texto: string): Map<string, string> {
  const dados: unknown = JSON.parse(texto);

  if (dados === null || typeof dados !== "object" || Array.isArray(dados)) {
    throw new Error("LOTE_MACS_JSON deve ser um objeto { uuid_da_estacao: mac }.");
  }

  const macs = new Map<string, string>();
  for (const [estacaoId, mac] of Object.entries(dados)) {
    if (typeof mac !== "string" || !MAC_VALIDO.test(mac)) {
      throw new Error(`LOTE_MACS_JSON: MAC inválido para a estação ${estacaoId}.`);
    }
    macs.set(estacaoId, mac);
  }
  return macs;
}

/**
 * Sensores ativos da estação, lidos do catálogo no gestao-estacoes a cada
 * chamada (sem cache): um sensor cadastrado agora entra no próximo ciclo.
 * Sensor inativo é pulado (a ingestão o ignora) e sensor com calibração que não
 * dá para inverter (fator zero) também, com aviso.
 */
export async function buscarSensoresDaEstacao(
  estacaoId: string,
  config: ConfigApi,
  buscar: Buscar = fetch,
): Promise<SensorSimulado[]> {
  const resposta = await buscar(
    `${config.url}/api/v1/internal/estacoes/${encodeURIComponent(estacaoId)}/sensores`,
    {
      headers: { "X-Internal-Token": config.tokenInterno },
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    },
  );

  if (!resposta.ok) {
    throw new Error(
      `gestao-estacoes respondeu ${resposta.status} ao listar os sensores da estação ${estacaoId}.`,
    );
  }

  return sensoresAtivos(estacaoId, await resposta.json());
}

/**
 * Sensores de várias estações já lidos antes (LOTE_SENSORES_JSON): usado pelo
 * teste de fluxo com o PostgreSQL parado, em que o gestao-estacoes não responde.
 * Formato: { "<uuid da estação>": [sensor da API, ...] }.
 */
export function lerSensoresDeJson(texto: string): Map<string, SensorSimulado[]> {
  const dados: unknown = JSON.parse(texto);

  if (dados === null || typeof dados !== "object" || Array.isArray(dados)) {
    throw new Error("LOTE_SENSORES_JSON deve ser um objeto { uuid_da_estacao: [sensores] }.");
  }

  return new Map(
    Object.entries(dados).map(([estacaoId, lista]) => [estacaoId, sensoresAtivos(estacaoId, lista)]),
  );
}

function sensoresAtivos(estacaoId: string, corpo: unknown): SensorSimulado[] {
  if (!Array.isArray(corpo)) {
    throw new Error(`Resposta inesperada ao listar os sensores da estação ${estacaoId}.`);
  }

  const sensores: SensorSimulado[] = [];
  for (const item of corpo as SensorDaEstacao[]) {
    if (item.status !== "Ativo") {
      continue;
    }

    const sensor = converterSensor(item);
    if (!sensor) {
      console.warn(
        `[simulador] Sensor ${item.codigo} da estação ${estacaoId} ignorado: ` +
          "calibração ou faixa inválida (fator_conversao zero?).",
      );
      continue;
    }

    sensores.push(sensor);
  }

  return sensores;
}
