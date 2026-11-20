import { MensagemBruta, MensagemIngestaoInput } from "../dto/mensagem-ingestao.dto";
import { randomUUID } from "node:crypto";
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
import { extrairEstacaoId } from "../utils/topico-estacao";
import { ESTACAO_DESCONHECIDA, PAYLOAD_MALFORMADO } from "../validations/motivos-rejeicao";
import { logger } from "../utils/logger";

export type ResultadoVerificacao = "pendente" | "encaminhada" | "recusada" | "duplicada";

const validador = new ValidarPayloadService();

// Rodada periódica: tenta de novo as mensagens que ficaram "recebida" por
// erro temporário e as que sobraram de uma queda do processo.
export const INTERVALO_VERIFICACAO_MS = 10000;
export const LIMITE_ATRASO_MS = 10 * 60 * 1000;

let verificando = false;
let deNovo = false;
let timer: NodeJS.Timeout | undefined;

/**
 * Leitura em dia vai para o Valkey. Leituras atrasadas e recusas conhecidas são
 * verificadas primeiro e não entram em staging:recebidas/staging:pendentes.
 * Se essa verificação prévia falhar (PostgreSQL fora, por exemplo), a mensagem
 * entra no Valkey e a rodada de verificação decide depois.
 */
export async function receberMensagem(mensagem: MensagemBruta): Promise<string> {
  const idDireto = await verificarAntesDoValkey(mensagem);
  if (idDireto) return idDireto;

  const id = await gravarBruta(mensagem);
  solicitarVerificacao();
  return id;
}

/**
 * Devolve o id quando a mensagem foi resolvida fora do Valkey (recusa conhecida
 * ou leitura atrasada). Devolve undefined quando ela deve entrar no Valkey:
 * leitura em dia, tópico sem UUID ou qualquer falha na verificação prévia.
 */
async function verificarAntesDoValkey(mensagem: MensagemBruta): Promise<string | undefined> {
  const estacaoId = extrairEstacaoId(mensagem.topico);
  if (!estacaoId) return undefined;

  const id = randomUUID();
  const staging: MensagemStaging = { ...mensagem, id, status: "recebida" };

  try {
    const validacao = validador.validar({ ...mensagem, estacaoId });
    const payload = validacao.sucesso ? validacao.payloadValidado : undefined;

    let foraDoValkey = payload === undefined;
    if (payload) {
      const motivoEstacao = await conferirEstacao(estacaoId, payload.timestamp, mensagem.recebidoEm);
      foraDoValkey =
        motivoEstacao !== undefined || leituraAtrasada(mensagem.recebidoEm, payload.timestamp);
    }
    if (!foraDoValkey) return undefined;

    await verificarMensagem(staging, () => new Date(), { foraDoValkey: true });
    return id;
  } catch (erro) {
    logger.warn("Verificação prévia falhou; seguindo pelo Valkey", {
      stagingId: id,
      topico: mensagem.topico,
      erro: motivo(erro),
    });
    return undefined;
  }
}

export function leituraAtrasada(recebidoEm: string, timestamp: string): boolean {
  return Date.parse(recebidoEm) - Date.parse(timestamp) > LIMITE_ATRASO_MS;
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
  opcoes: { foraDoValkey?: boolean } = {},
): Promise<ResultadoVerificacao> {
  const estacaoId = extrairEstacaoId(staging.topico);
  if (!estacaoId) {
    return recusar(staging, ESTACAO_DESCONHECIDA, agora(), undefined, opcoes.foraDoValkey);
  }

  const mensagem: MensagemIngestaoInput = {
    estacaoId,
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
  const motivoEstacao = await conferirEstacao(
    estacaoId,
    validacao.payloadValidado.timestamp,
    staging.recebidoEm,
  );
  if (motivoEstacao !== undefined) {
    return recusar(staging, motivoEstacao, agora(), mensagem, opcoes.foraDoValkey);
  }

  // Duplicata (US-13) pela chave staging:visto no Valkey, mesmo com o PostgreSQL fora.
  const { timestamp, nivel_bateria } = validacao.payloadValidado;
  const unixtime = Math.floor(Date.parse(timestamp) / 1000);
  if ((await marcarVisto(estacaoId, unixtime, staging.id, agora())) === "duplicada") {
    await encerrarSemPublicar(staging.id, "duplicada", agora());
    registrarDuplicadaIgnorada({ estacaoId, timestamp });
    return "duplicada";
  }

  if (foraDoValkey) {
    const unixtime = Math.floor(Date.parse(validacao.payloadValidado.timestamp) / 1000);
    logger.info("Leitura atrasada gravada direto no PostgreSQL", {
      estacao_uuid: estacaoId,
      unixtime,
      atraso_s: (Date.parse(staging.recebidoEm) - Date.parse(validacao.payloadValidado.timestamp)) / 1000,
    });
    await publicarLeituraAtrasada({
      staging_id: staging.id,
      estacao_uuid: estacaoId,
      unixtime,
      recebidoEm: new Date(staging.recebidoEm).toISOString(),
      leituras: validacao.payloadValidado.leituras,
    });
    await marcarStagingPublicada(staging.id);
    gravacaoMetricsService.incrementarGravada();
    return "encaminhada";
  }

  await marcarPendente(staging.id);
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
  foraDoValkey = false,
): Promise<ResultadoVerificacao> {
  await encerrarSemPublicar(staging.id, "recusada", agora, motivoRecusa);
  registrarRejeicao(motivoRecusa, mensagem?.estacaoId ?? staging.topico);
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
