import { MensagemBruta, MensagemIngestaoInput } from "../dto/mensagem-ingestao.dto";
import {
  encerrarSemPublicar,
  gravarBruta,
  lerMensagem,
  listarRecebidas,
  marcarPendente,
  marcarVisto,
  MensagemStaging,
} from "../repositories/staging-valkey.repository";
import { atualizarSinalEstacao } from "../repositories/estacao.repository";
import { ValidarPayloadService } from "./validar-payload.service";
import { conferirEstacao } from "./validar-estacao.service";
import { registrarRejeicao } from "./registro-rejeicao.service";
import { registrarDuplicadaIgnorada } from "./registro-duplicada.service";
import { solicitarProcessamentoPendentes } from "./staging-publisher.service";
import { extrairMacDoTopico } from "../utils/topico-estacao";
import { ESTACAO_DESCONHECIDA, PAYLOAD_MALFORMADO } from "../validations/motivos-rejeicao";
import { logger } from "../utils/logger";

export type ResultadoVerificacao = "pendente" | "recusada" | "duplicada";

const validador = new ValidarPayloadService();

// Rodada periódica: tenta de novo as mensagens que ficaram "recebida" por
// erro temporário e as que sobraram de uma queda do processo.
export const INTERVALO_VERIFICACAO_MS = 10000;

let verificando = false;
let deNovo = false;
let timer: NodeJS.Timeout | undefined;

/**
 * Próximo passo do consumidor MQTT (US-40): grava a mensagem bruta no Valkey
 * antes de qualquer verificação. O broker só recebe o PUBACK depois que esta
 * Promise resolve; se o Valkey falhar, ela rejeita e a mensagem não é confirmada.
 */
export async function receberMensagem(mensagem: MensagemBruta): Promise<string> {
  const id = await gravarBruta(mensagem);
  solicitarVerificacao();
  return id;
}

export function iniciarVerificacao(intervaloMs = INTERVALO_VERIFICACAO_MS): void {
  if (!timer) timer = setInterval(solicitarVerificacao, intervaloMs);
  solicitarVerificacao();
}

export function encerrarVerificacao(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}

export function solicitarVerificacao(): void {
  void verificarRecebidas();
}

/**
 * Verifica a fila staging:recebidas, uma rodada por vez dentro do processo.
 * Um pedido durante a rodada gera outra logo em seguida.
 */
export async function verificarRecebidas(): Promise<void> {
  if (verificando) {
    deNovo = true;
    return;
  }
  verificando = true;
  try {
    do {
      deNovo = false;
      await rodada();
    } while (deNovo);
  } catch (erro) {
    // Valkey fora: a fila continua lá e é lida de novo na próxima rodada.
    logger.error("Falha ao ler a fila de verificação no Valkey", { erro: motivo(erro) });
  } finally {
    verificando = false;
  }
}

/**
 * Erro numa mensagem (PostgreSQL fora e estação nunca vista, por exemplo) é
 * temporário: ela continua "recebida" e as próximas seguem. As mensagens
 * seguintes do mesmo tópico (mesma estação) esperam, para manter a ordem
 * por estação; as de outras estações não.
 */
async function rodada(): Promise<void> {
  const adiados = new Set<string>();

  for (const id of await listarRecebidas()) {
    const mensagem = await lerMensagem(id);
    if (!mensagem || adiados.has(mensagem.topico)) continue;

    try {
      await verificarMensagem(mensagem);
    } catch (erro) {
      adiados.add(mensagem.topico);
      logger.warn("Verificação adiada para a próxima rodada", {
        stagingId: id,
        topico: mensagem.topico,
        erro: motivo(erro),
      });
    }
  }
}

/**
 * Verificações de formato e estação (US-12) e de horário (US-28), sobre a
 * mensagem lida do Valkey. Erro permanente vira "recusada" com o motivo e não
 * segue para telemetria.bruta; exceção é erro temporário. O agora marca o
 * início dos 7 dias de expiração da recusada e da duplicada.
 */
export async function verificarMensagem(
  staging: MensagemStaging,
  agora: () => Date = () => new Date(),
): Promise<ResultadoVerificacao> {
  const macAddress = extrairMacDoTopico(staging.topico);
  if (!macAddress) {
    return recusar(staging, ESTACAO_DESCONHECIDA, agora());
  }

  const mensagem: MensagemIngestaoInput = {
    macAddress,
    topico: staging.topico,
    payloadBruto: staging.payloadBruto,
    recebidoEm: staging.recebidoEm,
  };

  const validacao = validador.validar(mensagem);
  if (!validacao.sucesso || !validacao.payloadValidado) {
    // Motivo sempre da lista MOTIVOS_REJEICAO: é ela que as métricas leem.
    return recusar(staging, validacao.motivoRejeicao ?? PAYLOAD_MALFORMADO, agora(), mensagem);
  }

  // A conferência da estação vem depois do payload, como na ordem dos critérios.
  const conferencia = await conferirEstacao(
    macAddress,
    validacao.payloadValidado.timestamp,
    staging.recebidoEm,
  );
  if (!conferencia.ok) {
    return recusar(staging, conferencia.motivo, agora(), mensagem);
  }
  const estacaoId = conferencia.estacaoId;

  // Duplicata (US-13) pela chave staging:visto no Valkey, mesmo com o PostgreSQL fora.
  const { timestamp, nivel_bateria } = validacao.payloadValidado;
  const unixtime = Math.floor(Date.parse(timestamp) / 1000);
  if ((await marcarVisto(estacaoId, unixtime, staging.id, agora())) === "duplicada") {
    await encerrarSemPublicar(staging.id, "duplicada", agora());
    registrarDuplicadaIgnorada({ estacaoId, timestamp });
    return "duplicada";
  }

  await marcarPendente(staging.id, estacaoId);
  solicitarProcessamentoPendentes();
  // Último sinal (US-14) só depois de a publicação já ter sido pedida. Com o
  // PostgreSQL fora, fica para a próxima leitura aceita.
  await semTravarNoPostgres(
    () => atualizarSinalEstacao({ estacaoId, ultimoPing: staging.recebidoEm, nivelBateria: nivel_bateria }),
    "atualizar o último sinal",
    staging.id,
  );
  return "pendente";
}

async function recusar(
  staging: MensagemStaging,
  motivoRecusa: string,
  agora: Date,
  mensagem?: MensagemIngestaoInput,
): Promise<ResultadoVerificacao> {
  await encerrarSemPublicar(staging.id, "recusada", agora, motivoRecusa);
  registrarRejeicao(motivoRecusa, mensagem?.macAddress ?? staging.topico);
  return "recusada";
}

/**
 * US-40 · Cenário 4: o último sinal fica no PostgreSQL. Falha ali vai para o
 * log e não trava o Valkey nem a publicação.
 */
export async function semTravarNoPostgres<T>(
  gravar: () => Promise<T>,
  acao: string,
  stagingId: string,
): Promise<T | undefined> {
  try {
    return await gravar();
  } catch (erro) {
    logger.error(`PostgreSQL indisponível ao ${acao}; a leitura segue pelo Valkey`, {
      stagingId,
      erro: motivo(erro),
    });
    return undefined;
  }
}

function motivo(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}
