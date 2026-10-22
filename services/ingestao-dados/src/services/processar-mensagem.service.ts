import { MensagemIngestaoInput } from "../dto/mensagem-ingestao.dto";
import { ValidarPayloadService } from "./validar-payload.service";
import {
  gravarAceita,
  gravarRejeitada,
  ResultadoGravacao,
} from "./gravar-staging.service";
import { conferirEstacao } from "./validar-estacao.service";
import { registrarRejeicao } from "./registro-rejeicao.service";
import { registrarDuplicadaIgnorada } from "./registro-duplicada.service";
import { logger } from "../utils/logger";

const validador = new ValidarPayloadService();

/** O consumidor deve confirmar a mensagem somente após esta Promise resolver. */
export async function processarMensagem(
  mensagem: MensagemIngestaoInput,
  motivoRejeicao?: string,
): Promise<ResultadoGravacao> {
  try {
    return await persistirMensagem(mensagem, motivoRejeicao);
  } catch (erro) {
    logger.error("Falha ao gravar mensagem no staging", {
      estacaoId: mensagem.estacaoId,
      erro: erro instanceof Error ? erro.message : String(erro),
    });
    throw erro;
  }
}

/**
 * Próximo passo do consumidor MQTT (TASK 11.05): cada mensagem de tópico
 * válido segue validação, duplicata, staging, último sinal e publicação.
 * Se a gravação falhar, a Promise rejeita e a mensagem não é confirmada.
 */
export async function encaminharParaIngestao(
  mensagem: MensagemIngestaoInput,
): Promise<void> {
  await processarMensagem(mensagem);
}

async function rejeitar(
  mensagem: MensagemIngestaoInput,
  motivo: string,
): Promise<ResultadoGravacao> {
  await gravarRejeitada(mensagem, motivo);
  registrarRejeicao(motivo, mensagem.estacaoId);
  return "rejeitada";
}

async function persistirMensagem(
  mensagem: MensagemIngestaoInput,
  motivoRejeicao?: string,
): Promise<ResultadoGravacao> {
  // Permite receber também rejeições de negócio já decididas na US-12.
  if (motivoRejeicao !== undefined) {
    return rejeitar(mensagem, motivoRejeicao);
  }
  const validacao = validador.validar(mensagem);

  if (!validacao.sucesso) {
    return rejeitar(mensagem, validacao.motivoRejeicao ?? "Payload inválido");
  }

  // US-12: a estação do tópico precisa existir e não pode estar Inativa.
  // A conferência vem depois do payload, como na ordem dos critérios.
  const motivoEstacao = await conferirEstacao(mensagem.estacaoId);
  if (motivoEstacao !== undefined) {
    return rejeitar(mensagem, motivoEstacao);
  }

  // A detecção de duplicata da TASK 13.01 é o índice único da staging
  // (uq_staging_estacao_unixtime) com o ON CONFLICT do inserirStaging.
  // "duplicata" significa que a mensagem foi ignorada: não grava e não segue.
  // TASK 13.02: só depois que gravarAceita resolve, a duplicata é registrada
  // (log INFO + contador); se a gravação falhar, nada é contado.
  const resultado = await gravarAceita(mensagem);
  if (resultado === "duplicata") {
    registrarDuplicadaIgnorada({
      estacaoId: mensagem.estacaoId,
      timestamp: validacao.payloadValidado?.timestamp ?? "",
    });
  }
  return resultado;
}
