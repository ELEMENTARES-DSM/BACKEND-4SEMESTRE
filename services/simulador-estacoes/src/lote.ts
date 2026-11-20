// Modo lote do simulador (US-21): publica um lote de tamanho conhecido e grava
// no manifesto, uma linha JSON por mensagem, tudo o que foi enviado. Termina
// sozinho quando o broker confirmou todas as mensagens.
import { writeFileSync } from "node:fs";
import { contarLeiturasEnviadas, lerCasos, planejarLote } from "./lote/plano.js";
import { criarClienteMqtt, publicar } from "./mqtt.client.js";
import { criarRng } from "./random.js";
import type { SensorSimulado } from "./sensores.js";
import { buscarSensoresDaEstacao, lerConfigApi, lerSensoresDeJson } from "./sensores.api.js";

const estacoes = (process.env.LOTE_ESTACOES ?? process.env.SIM_ESTACAO_IDS ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const medidas = Number(process.env.LOTE_MEDIDAS ?? "1000");
const inicioUnix = Number(process.env.LOTE_INICIO_UNIX ?? Math.floor(Date.now() / 1000));
const manifesto = process.env.LOTE_MANIFESTO ?? "manifesto-lote.jsonl";

if (!Number.isInteger(inicioUnix) || inicioUnix <= 0) {
  throw new Error("LOTE_INICIO_UNIX deve ser um unixtime em segundos.");
}

// Os sensores de cada estação vêm do gestao-estacoes (catálogo), não de uma lista fixa.
// Com LOTE_SENSORES_JSON (teste de fluxo com o PostgreSQL parado) usa os sensores
// já lidos; sem ele, lê da rota interna.
const sensoresPorEstacao = process.env.LOTE_SENSORES_JSON?.trim()
  ? lerSensoresDeJson(process.env.LOTE_SENSORES_JSON)
  : new Map<string, SensorSimulado[]>();
if (sensoresPorEstacao.size === 0) {
  const config = lerConfigApi();
  for (const estacao of new Set(estacoes)) {
    sensoresPorEstacao.set(estacao, await buscarSensoresDaEstacao(estacao, config));
  }
}

const mensagens = planejarLote({
  estacoes,
  sensoresPorEstacao,
  medidas,
  inicioUnix,
  casos: lerCasos(process.env.LOTE_CASOS),
  rng: criarRng(process.env.LOTE_SEMENTE?.trim() || undefined),
});

const client = criarClienteMqtt();

client.once("connect", () => {
  void (async () => {
    try {
      for (const mensagem of mensagens) {
        for (let i = 0; i < mensagem.vezes; i++) {
          await publicar(client, mensagem.estacao_uuid, mensagem.payload_bruto);
        }
      }

      writeFileSync(
        manifesto,
        mensagens.map((m) => JSON.stringify(m)).join("\n") + "\n",
        "utf-8",
      );
      console.log(
        `[lote] Publicadas ${mensagens.length} mensagens ` +
        `(${contarLeiturasEnviadas(mensagens)} leituras) em ${estacoes.length} estações. ` +
        `Manifesto: ${manifesto}`,
      );
      client.end(false, {}, () => process.exit(0));
    } catch (error) {
      console.error("[lote] Falha ao publicar o lote:", error);
      client.end(true, {}, () => process.exit(1));
    }
  })();
});
