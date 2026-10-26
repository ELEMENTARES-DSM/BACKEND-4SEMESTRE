import amqp, { ChannelModel, ConfirmChannel, GetMessage } from "amqplib";
import { FILA_VALIDACAO_TELEMETRIA } from "../events/consumers/rabbitmq-telemetria.consumer";
import { FILA_VALIDACAO_DLQ } from "../events/publishers/rabbitmq-dlq.publisher";
import { EVENTO_MALFORMADO } from "../validations/motivos-recusa";
import logger from "../utils/logger";

export interface ResultadoReenvio {
  reenviados: number;
  restantes: number;
}

/** RabbitMQ fora do ar antes ou durante o reenvio: o que não foi reenviado fica na DLQ. */
export class RabbitMqIndisponivelError extends Error {
  constructor(
    message: string,
    public readonly reenviados = 0,
  ) {
    super(message);
    this.name = "RabbitMqIndisponivelError";
  }
}

export interface OpcoesReenvioDlq {
  url?: string;
  conectar?: (url: string) => Promise<ChannelModel>;
}

/**
 * Ajusta o formato do evento antes de voltar para a validacao.telemetria (US-20):
 * - evento do limite de entregas (sem `motivo`): volta como está;
 * - leitura recusada da US-18: sai `motivo` e `recusado_em`;
 * - evento malformado da US-18: volta o conteúdo original, guardado em `leituras`.
 */
export function ajustarFormatoParaReenvio(conteudo: Buffer): Buffer {
  let evento: unknown;
  try {
    evento = JSON.parse(conteudo.toString("utf-8"));
  } catch {
    return conteudo;
  }

  if (!evento || typeof evento !== "object" || Array.isArray(evento) || !("motivo" in evento)) {
    return conteudo;
  }

  const normal = { ...(evento as Record<string, unknown>) };
  const motivo = normal.motivo;
  delete normal.motivo;
  delete normal.recusado_em;
  if (motivo === EVENTO_MALFORMADO) {
    const original = normal.leituras;
    return Buffer.from(typeof original === "string" ? original : JSON.stringify(original));
  }
  return Buffer.from(JSON.stringify(normal));
}

/**
 * Reenvio da validacao.dlq para a validacao.telemetria (TASK 20.03). Retira os
 * eventos mais antigos primeiro, no máximo o número que estava na DLQ no início
 * da chamada: o que voltar para a DLQ durante o reenvio fica no fim da fila e
 * não é reenviado de novo na mesma chamada. Cada evento só sai da DLQ depois de
 * o RabbitMQ confirmar a publicação na fila principal.
 */
export async function reenviarEventosDlq(
  quantidade?: number,
  opcoes: OpcoesReenvioDlq = {},
): Promise<ResultadoReenvio> {
  const url = opcoes.url ?? process.env.RABBITMQ_URL ?? "amqp://localhost:5672";
  const conectar = opcoes.conectar ?? amqp.connect;

  let connection: ChannelModel;
  try {
    connection = await conectar(url);
  } catch (erro) {
    throw new RabbitMqIndisponivelError(motivoErro(erro));
  }
  // Sem ouvinte, um erro de conexão durante o reenvio derrubaria o processo.
  connection.on("error", (erro: Error) => {
    logger.error("Erro na conexão de reenvio da DLQ", { erro: erro.message });
  });

  let reenviados = 0;
  try {
    const canal = await connection.createConfirmChannel();
    canal.on("error", (erro: Error) => {
      logger.error("Erro no canal de reenvio da DLQ", { erro: erro.message });
    });

    await canal.checkQueue(FILA_VALIDACAO_TELEMETRIA);
    const { messageCount: naDlqNoInicio } = await canal.checkQueue(FILA_VALIDACAO_DLQ);
    const limite =
      quantidade === undefined ? naDlqNoInicio : Math.min(quantidade, naDlqNoInicio);

    while (reenviados < limite) {
      const mensagem = await canal.get(FILA_VALIDACAO_DLQ, { noAck: false });
      if (!mensagem) {
        break;
      }
      await reenviarUm(canal, mensagem);
      reenviados += 1;
    }

    const { messageCount: restantes } = await canal.checkQueue(FILA_VALIDACAO_DLQ);
    await canal.close().catch(() => undefined);
    return { reenviados, restantes };
  } catch (erro) {
    logger.error("Reenvio da DLQ interrompido; os eventos não reenviados continuam na DLQ", {
      reenviados,
      erro: motivoErro(erro),
    });
    throw new RabbitMqIndisponivelError(motivoErro(erro), reenviados);
  } finally {
    // Fechar a conexão devolve à DLQ qualquer evento retirado e ainda não confirmado.
    await connection.close().catch(() => undefined);
  }
}

async function reenviarUm(canal: ConfirmChannel, mensagem: GetMessage): Promise<void> {
  try {
    canal.sendToQueue(FILA_VALIDACAO_TELEMETRIA, ajustarFormatoParaReenvio(mensagem.content), {
      persistent: true,
      contentType: "application/json",
      messageId: mensagem.properties.messageId,
    });
    await canal.waitForConfirms();
  } catch (erro) {
    // Publicação não confirmada: o evento volta para a DLQ.
    try {
      canal.nack(mensagem, false, true);
    } catch {
      // Canal fechado: o RabbitMQ devolve o evento à DLQ sozinho.
    }
    throw erro;
  }
  canal.ack(mensagem);
}

function motivoErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}
