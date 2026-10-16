import { MensagemIngestaoInput } from "../dto/mensagem-ingestao.dto";
import { ValidarPayloadService } from "./validar-payload.service";
import {
  gravarAceita,
  gravarRejeitada,
  ResultadoGravacao,
} from "./gravar-staging.service";
import { registrarRejeicao } from "./registro-rejeicao.service";
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

async function persistirMensagem(
  mensagem: MensagemIngestaoInput,
  motivoRejeicao?: string,
): Promise<ResultadoGravacao> {
  // Permite receber também rejeições de negócio já decididas na US-12.
  if (motivoRejeicao !== undefined) {
    await gravarRejeitada(mensagem, motivoRejeicao);
    registrarRejeicao(motivoRejeicao, mensagem.estacaoId);
    return "rejeitada";
  }
  const validacao = validador.validar(mensagem);

  if (!validacao.sucesso) {
    const motivo = validacao.motivoRejeicao ?? "Payload inválido";
    await gravarRejeitada(mensagem, motivo);
    registrarRejeicao(motivo, mensagem.estacaoId);
    return "rejeitada";
  }

  // A detecção de duplicata da TASK 13.01 é o índice único da staging
  // (uq_staging_estacao_unixtime) com o ON CONFLICT do inserirStaging.
  // "duplicata" significa que a mensagem foi ignorada: não grava e não segue.
  // TASK 13.02: quando o resultado for "duplicata", registrar log e contador aqui
  return gravarAceita(mensagem);
}
