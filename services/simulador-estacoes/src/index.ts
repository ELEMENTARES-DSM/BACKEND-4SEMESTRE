
import { criarClienteMqtt, publicar } from "./mqtt.client.js";
import { gerarTelemetria } from "./telemetria.factory.js";

const estacaoIds = (process.env.SIM_ESTACAO_IDS ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

const intervaloMs =
  Number(process.env.SIM_INTERVALO_S ?? "5") * 1000;

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

const client = criarClienteMqtt();

let cicloEmExecucao = false;
let encerrando = false;

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
        const payload = gerarTelemetria();

        await publicar(client, estacaoId, payload);

        console.log(
          `[simulador] Publicado para estação ${estacaoId}: ` +
          `${payload.leituras.length} leituras`,
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

// Publica assim que conectar e também após reconexões.
client.on("connect", () => {
  void executarCiclo();
});

console.log(`[simulador] Estações configuradas: ${estacaoIds.length}`);
console.log(`[simulador] Intervalo: ${intervaloMs / 1000}s`);

function encerrar(): void {
  if (encerrando) return;

  encerrando = true;
  clearInterval(timer);

  client.end(false, {}, () => {
    console.log("[simulador] Cliente MQTT encerrado.");
    process.exit(0);
  });

  // Evita manter o processo preso indefinidamente no encerramento.
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", encerrar);
process.on("SIGTERM", encerrar);
