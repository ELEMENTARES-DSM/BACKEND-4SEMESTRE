import { Channel, ChannelModel, ConfirmChannel } from "amqplib";
import { AlarmeRow, EventoAlarmeDisparadoDTO } from "../../dto/alarme.dto";
import logger from "../../utils/logger";

// US-22: contrato do evento alarme.disparado, consumido pelo alertas-notificacoes
// (US-23). Os dois serviços declaram a mesma topologia, com os mesmos argumentos.
export const EXCHANGE_ALARME_DISPARADO = "alarme.disparado";
export const FILA_NOTIFICACAO_ALARMES = "notificacao.alarmes";
export const EXCHANGE_NOTIFICACAO_DLX = "notificacao.dlx";
export const FILA_NOTIFICACAO_DLQ = "notificacao.dlq";
export const ARGUMENTOS_FILA_NOTIFICACAO = {
  "x-queue-type": "quorum",
  "x-delivery-limit": 3,
  "x-dead-letter-exchange": EXCHANGE_NOTIFICACAO_DLX,
} as const;

/**
 * Declara, de forma idempotente, a exchange do evento e a fila do consumidor com
 * DLX e DLQ. O publicador também declara a fila para que nenhum evento se perca
 * enquanto o alertas-notificacoes ainda não subiu.
 */
export async function declararTopologiaAlarmes(canal: Channel): Promise<void> {
  await canal.assertExchange(EXCHANGE_ALARME_DISPARADO, "fanout", { durable: true });
  await canal.assertExchange(EXCHANGE_NOTIFICACAO_DLX, "fanout", { durable: true });
  await canal.assertQueue(FILA_NOTIFICACAO_ALARMES, {
    durable: true,
    arguments: { ...ARGUMENTOS_FILA_NOTIFICACAO },
  });
  await canal.bindQueue(FILA_NOTIFICACAO_ALARMES, EXCHANGE_ALARME_DISPARADO, "");
  await canal.assertQueue(FILA_NOTIFICACAO_DLQ, { durable: true });
  await canal.bindQueue(FILA_NOTIFICACAO_DLQ, EXCHANGE_NOTIFICACAO_DLX, "");
}

const comoIso = (data: Date | string): string => new Date(data).toISOString();

export function montarEventoAlarme(alarme: AlarmeRow): EventoAlarmeDisparadoDTO {
  return {
    alarme_id: alarme.id,
    regra_id: alarme.regra_id,
    medida_id: alarme.medida_id,
    sensor_id: alarme.sensor_id,
    estacao_id: alarme.estacao_id,
    municipio: alarme.municipio,
    valor: String(alarme.valor),
    operador: alarme.operador,
    limite: String(alarme.limite),
    severidade: alarme.severidade,
    lido_em: comoIso(alarme.lido_em),
    criado_em: comoIso(alarme.criado_em),
  };
}

/**
 * Publica alarme.disparado e só resolve depois que o RabbitMQ confirma. Usa um
 * canal com confirmação próprio, aberto na conexão do consumidor no primeiro uso.
 */
export class PublicadorAlarmes {
  private canal?: ConfirmChannel;
  private abrindo?: Promise<ConfirmChannel>;

  constructor(private readonly obterConexao: () => ChannelModel | undefined) {}

  public async publicar(alarmes: AlarmeRow[]): Promise<void> {
    if (alarmes.length === 0) {
      return;
    }

    const canal = await this.obterCanal();
    for (const alarme of alarmes) {
      canal.publish(
        EXCHANGE_ALARME_DISPARADO,
        "",
        Buffer.from(JSON.stringify(montarEventoAlarme(alarme))),
        {
          persistent: true,
          contentType: "application/json",
          messageId: alarme.id,
        },
      );
    }
    // Rejeita se o RabbitMQ recusar alguma mensagem ou se o canal cair.
    await canal.waitForConfirms();
  }

  /** Chamado quando a conexão do consumidor cai: o canal antigo não vale mais. */
  public descartarCanal(): void {
    const canal = this.canal;
    this.canal = undefined;
    this.abrindo = undefined;
    void canal?.close().catch(() => undefined);
  }

  private obterCanal(): Promise<ConfirmChannel> {
    if (this.canal) {
      return Promise.resolve(this.canal);
    }
    if (!this.abrindo) {
      this.abrindo = this.abrirCanal().finally(() => {
        this.abrindo = undefined;
      });
    }
    return this.abrindo;
  }

  private async abrirCanal(): Promise<ConfirmChannel> {
    const conexao = this.obterConexao();
    if (!conexao) {
      throw new Error("Sem conexão com o RabbitMQ para publicar alarmes");
    }

    const canal = await conexao.createConfirmChannel();
    canal.on("error", (erro: Error) => {
      logger.error("Erro no canal de publicação de alarmes", {
        exchange: EXCHANGE_ALARME_DISPARADO,
        erro: erro.message,
      });
    });
    canal.on("close", () => {
      if (this.canal === canal) {
        this.canal = undefined;
      }
    });

    await declararTopologiaAlarmes(canal);
    this.canal = canal;
    return canal;
  }
}
