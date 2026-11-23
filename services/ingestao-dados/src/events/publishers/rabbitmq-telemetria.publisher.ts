import amqp, { ChannelModel, ConfirmChannel, Message } from "amqplib";
import {
  descartarPendente,
  lerMensagem,
  marcarEncaminhada,
  MensagemStaging,
  proximaPendente,
} from "../../repositories/staging-valkey.repository";

export const EXCHANGE_TELEMETRIA_BRUTA = "telemetria.bruta";
export const FILA_VALIDACAO_TELEMETRIA = "validacao.telemetria";
export const EXCHANGE_VALIDACAO_DLX = "validacao.dlx";
export const FILA_VALIDACAO_DLQ = "validacao.dlq";

export interface RabbitMqPublisherOptions {
  url: string;
  conectar?: (url: string) => Promise<ChannelModel>;
  reconectarMs?: number;
  intervaloRecuperacaoMs?: number;
  confirmTimeoutMs?: number;
  // Relógio da expiração de 7 dias; injetado nos testes.
  agora?: () => Date;
}

export interface EventoTelemetriaBruta {
  staging_id: string;
  estacao_uuid: string;
  unixtime: number;
  leituras: Array<{ sensor: string; valor: number }>;
}

// Mensagem aceita antes da troca para MAC: o tópico ainda traz o UUID da estação.
const TOPICO_LEGADO_UUID =
  /^pulso\/estacoes\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/telemetria$/i;

/** Evento de telemetria.bruta a partir da mensagem do Valkey, já verificada (US-12/US-28). */
export function montarEvento(mensagem: MensagemStaging): EventoTelemetriaBruta {
  // Gravado na verificação. Para mensagens que já estavam na fila no deploy, o
  // UUID sai do tópico antigo; sem nenhum dos dois não há estação e o evento não sai.
  const estacaoUuid =
    mensagem.estacaoId ?? TOPICO_LEGADO_UUID.exec(mensagem.topico)?.[1]?.toLowerCase();
  if (!estacaoUuid) {
    throw new Error(`mensagem ${mensagem.id} sem estação resolvida`);
  }
  const payload = JSON.parse(mensagem.payloadBruto) as {
    timestamp: string | number;
    leituras: Array<{ sensor: string; valor: number }>;
  };
  // Epoch em segundos já é o unixtime; string ISO continua sendo convertida.
  const unixtime =
    typeof payload.timestamp === "number"
      ? payload.timestamp
      : Math.floor(Date.parse(payload.timestamp) / 1000);
  return {
    staging_id: mensagem.id,
    estacao_uuid: estacaoUuid,
    unixtime,
    leituras: payload.leituras.map(({ sensor, valor }) => ({ sensor, valor })),
  };
}

export class RabbitMqTelemetriaPublisher {
  private connection?: ChannelModel;
  private channel?: ConfirmChannel;
  private reconectarTimer?: NodeJS.Timeout;
  private recuperacaoTimer?: NodeJS.Timeout;
  private processando = false;
  private deNovo = false;
  private encerrando = false;

  constructor(private readonly options: RabbitMqPublisherOptions) {}

  async iniciar(): Promise<void> {
    if (!this.recuperacaoTimer) {
      this.recuperacaoTimer = setInterval(
        () => void this.processarPendentes(),
        this.options.intervaloRecuperacaoMs ?? 10000,
      );
    }
    await this.conectar();
  }

  async encerrar(): Promise<void> {
    this.encerrando = true;
    if (this.reconectarTimer) clearTimeout(this.reconectarTimer);
    if (this.recuperacaoTimer) clearInterval(this.recuperacaoTimer);
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
        if (this.connection === connection) {
          this.channel = undefined;
          this.connection = undefined;
          this.agendarReconexao();
        }
      });
      const channel = await connection.createConfirmChannel();
      channel.on("close", () => {
        if (this.channel === channel) {
          this.channel = undefined;
          this.connection = undefined;
          void connection.close().catch(() => undefined);
          this.agendarReconexao();
        }
      });
      this.channel = channel;
      await this.declararTopologia(channel);
      console.log("[rabbitmq] conectado e topologia de telemetria declarada");
      void this.processarPendentes();
    } catch (erro) {
      const channel = this.channel;
      const connection = this.connection;
      this.channel = undefined;
      this.connection = undefined;
      await channel?.close().catch(() => undefined);
      await connection?.close().catch(() => undefined);
      // As pendentes continuam em staging:pendentes e saem na ordem quando ele voltar.
      console.error(`[rabbitmq] indisponível: ${this.motivo(erro)}`);
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

  /**
   * Publica staging:pendentes na ordem da lista (US-40). Uma única rodada por
   * vez dentro do processo; um pedido durante a rodada gera outra logo depois.
   * A instância é uma só: o clientId MQTT fixo não deixa duas consumirem juntas.
   */
  async processarPendentes(): Promise<void> {
    if (this.encerrando) return;
    if (this.processando) {
      this.deNovo = true;
      return;
    }
    this.processando = true;
    try {
      do {
        this.deNovo = false;
        const channel = this.channel;
        if (!channel) return;
        await this.declararTopologia(channel);
        await this.publicarLista(channel);
      } while (this.deNovo && !this.encerrando);
    } catch (erro) {
      // Valkey ou RabbitMQ fora: as pendentes continuam na lista para a próxima rodada.
      console.error(`[rabbitmq] rodada de publicação interrompida: ${this.motivo(erro)}`);
    } finally {
      this.processando = false;
    }
  }

  private async publicarLista(channel: ConfirmChannel): Promise<void> {
    const agora = this.options.agora ?? (() => new Date());

    while (this.channel === channel && !this.encerrando) {
      const id = await proximaPendente();
      if (!id) return;

      const mensagem = await lerMensagem(id);
      if (!mensagem) {
        console.warn(`[rabbitmq] pendente ${id} sem mensagem no Valkey, retirada da lista`);
        await descartarPendente(id);
        continue;
      }

      try {
        await this.publicarConfirmado(channel, montarEvento(mensagem));
      } catch (erro) {
        // Para a rodada: a mensagem continua na frente da lista e é publicada de
        // novo na reconexão ou na rodada periódica, mantendo a ordem.
        console.error(`[rabbitmq] falha ao publicar ${id}: ${this.motivo(erro)}`);
        return;
      }
      await marcarEncaminhada(id, agora());
    }
  }

  private publicarConfirmado(channel: ConfirmChannel, evento: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      let devolvida: string | undefined;
      let confirmada = false;
      let finalizada = false;
      let timer: NodeJS.Timeout | undefined;
      const timeoutConfirmacao: { handle?: NodeJS.Timeout } = {};
      const limpar = (): void => {
        if (timeoutConfirmacao.handle) clearTimeout(timeoutConfirmacao.handle);
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
      timeoutConfirmacao.handle = setTimeout(() => {
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
            if (timeoutConfirmacao.handle) clearTimeout(timeoutConfirmacao.handle);
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
