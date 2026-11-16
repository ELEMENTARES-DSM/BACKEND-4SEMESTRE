import { MensagemBruta, MensagemIngestaoInput } from "../dto/mensagem-ingestao.dto";
import {
  encerrarSemPublicar,
  gravarBruta,
  lerMensagem,
  listarRecebidas,
  marcarPendente,
  MensagemStaging,
} from "../repositories/staging-valkey.repository";
import { ValidarPayloadService } from "./validar-payload.service";
import { gravarAceita, gravarRejeitada } from "./gravar-staging.service";
import { conferirEstacao } from "./validar-estacao.service";
import { registrarRejeicao } from "./registro-rejeicao.service";
import { registrarDuplicadaIgnorada } from "./registro-duplicada.service";
import { gravacaoMetricsService } from "./gravacao-metrics.service";
import { extrairEstacaoId } from "../utils/topico-estacao";
import { ESTACAO_DESCONHECIDA } from "../validations/motivos-rejeicao";
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
 * segue para telemetria.bruta; exceção é erro temporário.
 */
export async function verificarMensagem(staging: MensagemStaging): Promise<ResultadoVerificacao> {
  const estacaoId = extrairEstacaoId(staging.topico);
  if (!estacaoId) {
    return recusar(staging, ESTACAO_DESCONHECIDA);
  }

  const mensagem: MensagemIngestaoInput = {
    estacaoId,
    topico: staging.topico,
    payloadBruto: staging.payloadBruto,
    recebidoEm: staging.recebidoEm,
  };

  const validacao = validador.validar(mensagem);
  if (!validacao.sucesso || !validacao.payloadValidado) {
    return recusar(staging, validacao.motivoRejeicao ?? "Payload inválido", mensagem);
  }

  // A conferência da estação vem depois do payload, como na ordem dos critérios.
  const motivoEstacao = await conferirEstacao(
    estacaoId,
    validacao.payloadValidado.timestamp,
    staging.recebidoEm,
  );
  if (motivoEstacao !== undefined) {
    return recusar(staging, motivoEstacao, mensagem);
  }

  // Até a 40.04, a duplicata (TASK 13.01) é o índice único da staging_telemetria.
  if ((await gravarAceita(mensagem, staging.id)) === "duplicata") {
    await encerrarSemPublicar(staging.id, "duplicada");
    registrarDuplicadaIgnorada({ estacaoId, timestamp: validacao.payloadValidado.timestamp });
    return "duplicada";
  }

  await marcarPendente(staging.id);
  gravacaoMetricsService.incrementarGravada();
  return "pendente";
}

async function recusar(
  staging: MensagemStaging,
  motivoRecusa: string,
  mensagem?: MensagemIngestaoInput,
): Promise<ResultadoVerificacao> {
  // Sem UUID no tópico não há estação para a linha da staging_telemetria.
  if (mensagem) await gravarRejeitada(mensagem, motivoRecusa, staging.id);
  await encerrarSemPublicar(staging.id, "recusada", motivoRecusa);
  gravacaoMetricsService.incrementarRejeitadaGravada();
  registrarRejeicao(motivoRecusa, mensagem?.estacaoId ?? staging.topico);
  return "recusada";
}

function motivo(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}
