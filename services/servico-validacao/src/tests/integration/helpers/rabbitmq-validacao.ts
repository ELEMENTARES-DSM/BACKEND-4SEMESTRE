import amqp, { Channel, ChannelModel } from "amqplib";
import { FILA_VALIDACAO_TELEMETRIA } from "../../../events/consumers/rabbitmq-telemetria.consumer";
import { EXCHANGE_VALIDACAO_DLX } from "../../../events/publishers/rabbitmq-dlq.publisher";

export const EXCHANGE_TELEMETRIA_BRUTA = "telemetria.bruta";
export const FILA_VALIDACAO_DLQ = "validacao.dlq";

export interface MensagemDlq {
  corpo: Record<string, unknown>;
  headers: Record<string, unknown>;
}

// Mesma topologia que o ingestao-dados declara (US-15).
export async function conectarAdmin(url: string): Promise<{
  connection: ChannelModel;
  channel: Channel;
}> {
  const connection = await amqp.connect(url);
  const channel = await connection.createChannel();
  await channel.assertExchange(EXCHANGE_TELEMETRIA_BRUTA, "fanout", { durable: true });
  await channel.assertExchange(EXCHANGE_VALIDACAO_DLX, "fanout", { durable: true });
  await channel.assertQueue(FILA_VALIDACAO_TELEMETRIA, {
    durable: true,
    arguments: {
      "x-queue-type": "quorum",
      "x-delivery-limit": 3,
      "x-dead-letter-exchange": EXCHANGE_VALIDACAO_DLX,
    },
  });
  await channel.bindQueue(FILA_VALIDACAO_TELEMETRIA, EXCHANGE_TELEMETRIA_BRUTA, "");
  await channel.assertQueue(FILA_VALIDACAO_DLQ, { durable: true });
  await channel.bindQueue(FILA_VALIDACAO_DLQ, EXCHANGE_VALIDACAO_DLX, "");
  return { connection, channel };
}

export async function limparFilas(channel: Channel): Promise<void> {
  await channel.purgeQueue(FILA_VALIDACAO_TELEMETRIA);
  await channel.purgeQueue(FILA_VALIDACAO_DLQ);
}

export function publicarEvento(channel: Channel, evento: unknown): void {
  const corpo = typeof evento === "string" ? evento : JSON.stringify(evento);
  channel.sendToQueue(FILA_VALIDACAO_TELEMETRIA, Buffer.from(corpo), { persistent: true });
}

export async function contarDlq(channel: Channel): Promise<number> {
  const { messageCount } = await channel.checkQueue(FILA_VALIDACAO_DLQ);
  return messageCount;
}

/** Retira todas as mensagens da DLQ (mais antigas primeiro). */
export async function lerDlq(channel: Channel): Promise<MensagemDlq[]> {
  const mensagens: MensagemDlq[] = [];
  for (;;) {
    const msg = await channel.get(FILA_VALIDACAO_DLQ, { noAck: true });
    if (!msg) return mensagens;
    mensagens.push({
      corpo: JSON.parse(msg.content.toString("utf-8")),
      headers: msg.properties.headers ?? {},
    });
  }
}

export async function esperar(
  condicao: () => Promise<boolean>,
  descricao: string,
  limiteMs = 10000,
): Promise<void> {
  const inicio = Date.now();
  while (!(await condicao())) {
    if (Date.now() - inicio > limiteMs) {
      throw new Error(`Tempo esgotado esperando ${descricao}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
