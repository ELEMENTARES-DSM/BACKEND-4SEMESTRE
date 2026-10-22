import { ChannelModel, ConfirmChannel } from "amqplib";
import { EventoRecusadoDTO } from "../../dto/evento-telemetria.dto";
import logger from "../../utils/logger";

// Exchange declarada pela US-15 (ingestao-dados); entrega na validacao.dlq.
export const EXCHANGE_VALIDACAO_DLX = "validacao.dlx";

/**
 * Publica na validacao.dlx os eventos recusados pelo servico-validacao (US-18)
 * e só resolve depois que o RabbitMQ confirma o recebimento. Usa um canal com
 * confirmação próprio, aberto na conexão do consumidor na primeira recusa.
 */
export class PublicadorDlqValidacao {
  private canal?: ConfirmChannel;
  private abrindo?: Promise<ConfirmChannel>;

  constructor(private readonly obterConexao: () => ChannelModel | undefined) {}

  public async publicar(eventos: EventoRecusadoDTO[]): Promise<void> {
    if (eventos.length === 0) {
      return;
    }

    const canal = await this.obterCanal();
    for (const evento of eventos) {
      canal.publish(
        EXCHANGE_VALIDACAO_DLX,
        "",
        Buffer.from(JSON.stringify(evento)),
        {
          persistent: true,
          contentType: "application/json",
          messageId: evento.staging_id ?? undefined,
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
      throw new Error("Sem conexão com o RabbitMQ para publicar na DLQ");
    }

    const canal = await conexao.createConfirmChannel();
    canal.on("error", (erro: Error) => {
      logger.error("Erro no canal de publicação da DLQ", {
        exchange: EXCHANGE_VALIDACAO_DLX,
        erro: erro.message,
      });
    });
    canal.on("close", () => {
      if (this.canal === canal) {
        this.canal = undefined;
      }
    });

    // Sem a exchange o RabbitMQ fecha o canal e a publicação falha.
    await canal.checkExchange(EXCHANGE_VALIDACAO_DLX);
    this.canal = canal;
    return canal;
  }
}
