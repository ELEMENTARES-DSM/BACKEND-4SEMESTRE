import amqp, { ChannelModel, ConfirmChannel, Message } from "amqplib";
import {
  marcarPendente,
  marcarPublicada,
  marcarRecebidasPendentes,
  liberarReservasAbandonadas,
  reservarProximaPendente,
} from "../../repositories/staging.repository";

export const EXCHANGE_TELEMETRIA_BRUTA = "telemetria.bruta";
export const FILA_VALIDACAO_TELEMETRIA = "validacao.telemetria";
export const EXCHANGE_VALIDACAO_DLX = "validacao.dlx";
export const FILA_VALIDACAO_DLQ = "validacao.dlq";

export interface RabbitMqPublisherOptions {
  url: string;
  conectar?: typeof amqp.connect;
  reconectarMs?: number;
  reprocessarMs?: number;
  confirmTimeoutMs?: number;
}

export class RabbitMqTelemetriaPublisher {
  private connection?: ChannelModel;
  private channel?: ConfirmChannel;
  private reconectarTimer?: NodeJS.Timeout;
  private reprocessarTimer?: NodeJS.Timeout;
  private processando = false;
  private encerrando = false;
  private reservasRestauradas = false;

  constructor(private readonly options: RabbitMqPublisherOptions) {}

  async iniciar(): Promise<void> {
    await this.conectar();
  }

  async encerrar(): Promise<void> {
    this.encerrando = true;
    if (this.reconectarTimer) clearTimeout(this.reconectarTimer);
    if (this.reprocessarTimer) clearTimeout(this.reprocessarTimer);
    await this.channel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
  }

  conectado(): boolean {
    return Boolean(this.channel && this.connection);
  }

  private async conectar(): Promise<void> {
    if (this.encerrando) return;
    try {
      const connect = this.options.conectar ?? amqp.connect;
      const connection = await connect(this.options.url);
      this.connection = connection;
      connection.on("error", (erro) => {
        console.error(`[rabbitmq] erro de conexão: ${erro.message}`);
      });
      connection.on("close", () => {
        this.channel = undefined;
        this.connection = undefined;
        void this.marcarRecebidasSemRabbit("Conexão com RabbitMQ encerrada");
        this.agendarReconexao();
      });
      const channel = await connection.createConfirmChannel();
      channel.on("close", () => {
        if (this.channel === channel) this.channel = undefined;
      });
      this.channel = channel;
      await this.declararTopologia(channel);
      if (!this.reservasRestauradas) {
        await liberarReservasAbandonadas();
        this.reservasRestauradas = true;
      }
      console.log("[rabbitmq] conectado e topologia de telemetria declarada");
      void this.processarPendentes();
    } catch (erro) {
      this.channel = undefined;
      console.error(`[rabbitmq] indisponível: ${this.motivo(erro)}`);
      await this.marcarRecebidasSemRabbit(`RabbitMQ indisponível: ${this.motivo(erro)}`);
      this.agendarReconexao();
    }
  }

  private async declararTopologia(channel: ConfirmChannel): Promise<void> {
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
  }

  private agendarReconexao(): void {
    if (this.encerrando || this.reconectarTimer) return;
    this.reconectarTimer = setTimeout(() => {
      this.reconectarTimer = undefined;
      void this.conectar();
    }, this.options.reconectarMs ?? 5000);
  }

  async processarPendentes(): Promise<void> {
    if (this.processando || this.encerrando) return;
    if (!this.channel) {
      await this.marcarRecebidasSemRabbit("RabbitMQ indisponível: sem conexão ativa");
      return;
    }
    this.processando = true;
    try {
      while (this.channel && !this.encerrando) {
        const registro = await reservarProximaPendente();
        if (!registro) break;
        const channel = this.channel;
        try {
          if (!Array.isArray(registro.payload?.leituras) || registro.payload.leituras.length < 1) {
            throw new Error("Payload do staging não contém leituras válidas");
          }
          const evento = {
            staging_id: registro.id,
            estacao_uuid: registro.estacao_uuid,
            unixtime: Number(registro.unixtime),
            leituras: registro.payload.leituras.map(({ sensor, valor }) => ({ sensor, valor })),
          };
          await this.publicarConfirmado(channel, evento);
          await marcarPublicada(registro.id);
        } catch (erro) {
          await marcarPendente(registro.id, this.motivo(erro));
          // Não repete imediatamente a mesma mensagem; aguarda o backoff ou reconexão.
          if (this.channel) this.agendarReprocessamento();
          break;
        }
      }
    } catch (erro) {
      console.error(`[rabbitmq] falha ao buscar mensagens pendentes: ${this.motivo(erro)}`);
    } finally {
      this.processando = false;
    }
  }

  private async marcarRecebidasSemRabbit(motivo: string): Promise<void> {
    try {
      await marcarRecebidasPendentes(motivo);
    } catch (erro) {
      console.error(`[rabbitmq] falha ao marcar mensagens pendentes: ${this.motivo(erro)}`);
    }
  }

  private agendarReprocessamento(): void {
    if (this.encerrando || this.reprocessarTimer || !this.channel) return;
    this.reprocessarTimer = setTimeout(() => {
      this.reprocessarTimer = undefined;
      void this.processarPendentes();
    }, this.options.reprocessarMs ?? 5000);
  }

  private publicarConfirmado(channel: ConfirmChannel, evento: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      let devolvida: string | undefined;
      let confirmada = false;
      let finalizada = false;
      let timer: NodeJS.Timeout | undefined;
      let timeoutConfirmacao: NodeJS.Timeout | undefined;
      const limpar = (): void => {
        if (timeoutConfirmacao) clearTimeout(timeoutConfirmacao);
        if (timer) clearTimeout(timer);
        channel.removeListener("return", retornada);
      };
      const terminar = (): void => {
        if (!confirmada || finalizada) return;
        finalizada = true;
        limpar();
        if (devolvida) reject(new Error(`Mensagem devolvida pelo RabbitMQ: ${devolvida}`));
        else resolve();
      };
      const retornada = (msg: Message): void => {
        const campos = msg.fields as typeof msg.fields & { replyText?: string; replyCode?: number };
        devolvida = `RabbitMQ ${campos.replyCode ?? ""}: ${campos.replyText ?? "mensagem devolvida sem rota"}`;
        terminar();
      };
      timeoutConfirmacao = setTimeout(() => {
        if (finalizada) return;
        finalizada = true;
        limpar();
        reject(new Error("RabbitMQ não confirmou a publicação dentro do prazo"));
      }, this.options.confirmTimeoutMs ?? 10000);
      channel.once("return", retornada);
      const payload = Buffer.from(JSON.stringify(evento));
      try {
        const aceito = channel.publish(EXCHANGE_TELEMETRIA_BRUTA, "", payload, {
          persistent: true,
          mandatory: true,
          contentType: "application/json",
          messageId: (evento as { staging_id: string }).staging_id,
          timestamp: (evento as { unixtime: number }).unixtime,
        }, (erro) => {
          if (finalizada) return;
          if (erro) {
            finalizada = true;
            limpar();
            reject(erro);
          } else {
            if (timeoutConfirmacao) clearTimeout(timeoutConfirmacao);
            confirmada = true;
            // RabbitMQ envia Basic.Return antes do Basic.Ack para mandatory.
            // Um tick dá ao cliente tempo de despachar o retorno antes de marcar sucesso.
            timer = setTimeout(terminar, 10);
          }
        });
        if (!aceito) {
          // ConfirmChannel mantém o callback até drenar; não é falha de publicação.
        }
      } catch (erro) {
        finalizada = true;
        limpar();
        reject(erro);
      }
    });
  }

  private motivo(erro: unknown): string {
    return erro instanceof Error ? erro.message : String(erro);
  }
}
