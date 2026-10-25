// Confere o balanço de um lote do simulador (US-21): espera o fluxo terminar,
// com limite de tempo, e encerra com erro se a diferença não for zero.
//
// Uso: npm run balanco -- --manifesto <arquivo> [--tempo-limite <segundos>]
// Variáveis: DATABASE_URL e RABBITMQ_URL (portas publicadas no Docker Compose).
import amqp from "amqplib";
import pg from "pg";
import { calcularBalanco, formatarBalanco, type Balanco } from "./balanco.js";
import { espiarDlq, lerBanco } from "./destinos.js";
import { lerManifesto, resolverCaminhoManifesto } from "./manifesto.js";

function argumento(nome: string): string | undefined {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const caminho = argumento("--manifesto");
const tempoLimiteS = Number(argumento("--tempo-limite") ?? "120");
const databaseUrl = process.env.DATABASE_URL;
const rabbitUrl = process.env.RABBITMQ_URL;

if (!caminho || !databaseUrl || !rabbitUrl || !Number.isFinite(tempoLimiteS) || tempoLimiteS <= 0) {
  console.error(
    "Uso: npm run balanco -- --manifesto <arquivo> [--tempo-limite <segundos>]\n" +
      "Defina DATABASE_URL e RABBITMQ_URL.",
  );
  process.exit(2);
}

const manifesto = lerManifesto(resolverCaminhoManifesto(caminho));
const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
pool.on("error", () => undefined);

// Banco ou RabbitMQ fora do ar durante a espera: tenta de novo na próxima volta.
async function conferir(): Promise<Balanco | undefined> {
  let conexao: amqp.ChannelModel | undefined;
  try {
    const banco = await lerBanco(pool, manifesto);
    conexao = await amqp.connect(rabbitUrl as string);
    const dlq = await espiarDlq(conexao);
    return calcularBalanco(manifesto, { ...banco, dlq });
  } catch (erro) {
    console.error(`[balanço] Sem leitura nesta volta: ${erro instanceof Error ? erro.message : String(erro)}`);
    return undefined;
  } finally {
    await conexao?.close().catch(() => undefined);
  }
}

async function main(): Promise<number> {
  const limite = Date.now() + tempoLimiteS * 1000;
  let ultimo: Balanco | undefined;

  for (;;) {
    ultimo = (await conferir()) ?? ultimo;
    const terminou = ultimo !== undefined && ultimo.diferenca === 0 && ultimo.emAndamento === 0;
    if (terminou || Date.now() >= limite) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log(`Balanço do lote (${caminho})`);
  if (!ultimo) {
    console.log("  não foi possível ler o banco e a DLQ");
    return 1;
  }
  console.log(formatarBalanco(ultimo));
  if (ultimo.diferenca !== 0) {
    console.log(`Diferença de ${ultimo.diferenca} medidas depois de ${tempoLimiteS} s: o lote não fechou.`);
    return 1;
  }
  console.log("Balanço fechado: nenhuma leitura perdida.");
  return 0;
}

main()
  .then(async (codigo) => {
    await pool.end().catch(() => undefined);
    process.exit(codigo);
  })
  .catch(async (erro) => {
    console.error("[balanço] Falha:", erro);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
