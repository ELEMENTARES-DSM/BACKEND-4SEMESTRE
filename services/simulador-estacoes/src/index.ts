import { Contadores } from "./contadores.js";
import {
  aplicarDefeito,
  lerTiposAtivos,
  mensagemValida,
  type TipoDefeito,
} from "./defeitos.js";
import { criarClienteMqtt, publicar } from "./mqtt.client.js";
import { criarRng } from "./random.js";
import { gerarTelemetria } from "./telemetria.factory.js";

const estacaoIds = (process.env.SIM_ESTACAO_IDS ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

const intervaloMs =
  Number(process.env.SIM_INTERVALO_S ?? "5") * 1000;

const taxaErro = Number(process.env.SIM_TAXA_ERRO ?? "0");
const tiposAtivos = lerTiposAtivos(process.env.SIM_TIPOS_ERRO);
const estacaoInativaId =
  process.env.SIM_ESTACAO_INATIVA_ID?.trim() || undefined;
const semente = process.env.SIM_SEED?.trim() || undefined;

if (estacaoIds.length === 0) {
  throw new Error(
    "Configure SIM_ESTACAO_IDS com pelo menos um UUID de estação.",
  );
}

if (!Number.isFinite(intervaloMs) || intervaloMs < 1000) {
  throw new Error(
    "SIM_INTERVALO_S deve ser um número igual ou maior que 1.",
  );
}

if (!Number.isFinite(taxaErro) || taxaErro < 0 || taxaErro > 100) {
  throw new Error("SIM_TAXA_ERRO deve ser um número de 0 a 100.");
}

if (
  taxaErro > 0 &&
  tiposAtivos.includes("estacao_inativa") &&
  !estacaoInativaId
) {
  throw new Error(
    "O defeito estacao_inativa está ligado: configure SIM_ESTACAO_INATIVA_ID " +
    "com o UUID de uma estação cadastrada e inativa.",
  );
}

const rng = criarRng(semente);
const contadores = new Contadores();
const client = criarClienteMqtt();

let cicloEmExecucao = false;
let encerrando = false;

// Decide se a próxima mensagem sai com defeito e de qual tipo.
function sortearDefeito(): TipoDefeito | null {
  if (taxaErro === 0 || tiposAtivos.length === 0) {
    return null;
  }

  if (rng() * 100 >= taxaErro) {
    return null;
  }

  return tiposAtivos[Math.floor(rng() * tiposAtivos.length)];
}

async function executarCiclo(): Promise<void> {
  if (
    cicloEmExecucao ||
    encerrando ||
    !client.connected
  ) {
    return;
  }

  cicloEmExecucao = true;

  try {
    for (const estacaoId of estacaoIds) {
      if (encerrando || !client.connected) {
        break;
      }

      try {
        const payload = gerarTelemetria(rng);
        const defeito = sortearDefeito();
        const mensagem = defeito
          ? aplicarDefeito(defeito, estacaoId, payload, rng, estacaoInativaId)
          : mensagemValida(estacaoId, payload);

        for (let i = 0; i < mensagem.vezes; i++) {
          await publicar(client, mensagem.estacaoId, mensagem.conteudo);
        }

        contadores.registrar(defeito, mensagem.vezes);

        console.log(
          `[simulador] Publicado para estação ${mensagem.estacaoId}: ` +
          (defeito ? `defeito ${defeito}` : "válida"),
        );
      } catch (error) {
        console.error(
          `[simulador] Falha na estação ${estacaoId}:`,
          error,
        );
      }
    }
  } finally {
    cicloEmExecucao = false;
  }
}

const timer = setInterval(() => {
  void executarCiclo();
}, intervaloMs);

// Log dos totais a cada minuto.
const timerLog = setInterval(() => {
  console.log(contadores.resumo());
}, 60_000);

// Publica assim que conectar e também após reconexões.
client.on("connect", () => {
  void executarCiclo();
});

console.log(`[simulador] Estações configuradas: ${estacaoIds.length}`);
console.log(`[simulador] Intervalo: ${intervaloMs / 1000}s`);
console.log(
  `[simulador] Taxa de erro: ${taxaErro}% | ` +
  `Tipos ligados: ${taxaErro > 0 ? tiposAtivos.join(", ") : "nenhum"} | ` +
  `Semente: ${semente ?? "nenhuma"}`,
);

function encerrar(): void {
  if (encerrando) return;

  encerrando = true;
  clearInterval(timer);
  clearInterval(timerLog);

  // Log dos totais ao parar.
  console.log(contadores.resumo());

  client.end(false, {}, () => {
    console.log("[simulador] Cliente MQTT encerrado.");
    process.exit(0);
  });

  // Evita manter o processo preso indefinidamente no encerramento.
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", encerrar);
process.on("SIGTERM", encerrar);
