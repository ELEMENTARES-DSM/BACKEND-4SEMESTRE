import amqp, { ChannelModel, ConfirmChannel, ConsumeMessage } from "amqplib";
import {
  EventoTelemetriaDTO,
  LeituraEventoDTO,
} from "../../dto/evento-telemetria.dto";
import {
  processarEventoTelemetria,
  ResultadoProcessamentoEvento,
} from "../../services/processar-telemetria.service";
import { concluirLeiturasIgnoradas } from "../../services/processar-leituras.service";
import logger from "../../utils/logger";

export const FILA_VALIDACAO_TELEMETRIA = "validacao.telemetria";
export const PREFETCH_VALIDACAO_TELEMETRIA = 10;
// Mesmo nome do exchange declarado pelo publisher do ingestao-dados (dono da topologia).
export const EXCHANGE_VALIDACAO_DLX = "validacao.dlx";
export const TIPO_LEITURA_SENSOR_INEXISTENTE = "leitura_sensor_inexistente";

export type ProcessadorEventoTelemetria = (
  evento: EventoTelemetriaDTO,
) => Promise<ResultadoProcessamentoEvento>;

export interface RabbitMqConsumerOptions {
  url: string;
  fila?: string;
  prefetch?: number;
  reconectarMs?: number;
  conectar?: (url: string) => Promise<ChannelModel>;
  processarEvento?: ProcessadorEventoTelemetria;
}

export interface EstadoSaudeRabbitMq {
  rabbitmq: "conectado" | "desconectado";
  fila: "disponivel" | "indisponivel";
}

export class ConsumidorRabbitMqTelemetria {
  private connection?: ChannelModel;
  private channel?: ConfirmChannel;
  private reconectarTimer?: NodeJS.Timeout;
  private encerrando = false;
  private conectando = false;
  private rabbitmqConectado = false;
  private filaDisponivel = false;

  private readonly fila: string;
  private readonly prefetch: number;
  private readonly reconectarMs: number;
  private readonly processarEvento: ProcessadorEventoTelemetria;

  constructor(private readonly options: RabbitMqConsumerOptions) {
    this.fila = options.fila ?? FILA_VALIDACAO_TELEMETRIA;
    this.prefetch = options.prefetch ?? PREFETCH_VALIDACAO_TELEMETRIA;
    this.reconectarMs = options.reconectarMs ?? 5000;
    this.processarEvento = options.processarEvento ?? processarEventoTelemetria;
  }

  public async iniciar(): Promise<void> {
    this.encerrando = false;
    await this.conectarOuConfigurarCanal();
  }

  public async encerrar(): Promise<void> {
    this.encerrando = true;
    if (this.reconectarTimer) {
      clearTimeout(this.reconectarTimer);
      this.reconectarTimer = undefined;
    }

    const channel = this.channel;
    const connection = this.connection;
    this.channel = undefined;
    this.connection = undefined;
    this.rabbitmqConectado = false;
    this.filaDisponivel = false;

    await channel?.close().catch(() => undefined);
    await connection?.close().catch(() => undefined);
  }

  public obterEstadoSaude(): EstadoSaudeRabbitMq {
    return {
      rabbitmq: this.rabbitmqConectado ? "conectado" : "desconectado",
      fila:
        this.rabbitmqConectado && this.filaDisponivel
          ? "disponivel"
          : "indisponivel",
    };
  }

  public estaSaudavel(): boolean {
    return this.rabbitmqConectado && this.filaDisponivel;
  }

  private async conectarOuConfigurarCanal(): Promise<void> {
    if (this.encerrando || this.conectando) {
      return;
    }

    this.conectando = true;
    try {
      let connection = this.connection;

      if (!connection) {
        const connect = this.options.conectar ?? amqp.connect;
        connection = await connect(this.options.url);
        this.connection = connection;
        this.rabbitmqConectado = true;

        connection.on("error", (erro: Error) => {
          logger.error("Erro na conexão com o RabbitMQ", {
            erro: erro.message,
          });
        });

        connection.on("close", () => {
          if (this.connection === connection) {
            this.channel = undefined;
            this.connection = undefined;
            this.rabbitmqConectado = false;
            this.filaDisponivel = false;
            logger.warn("Conexão com o RabbitMQ encerrada", {
              fila: this.fila,
            });
            this.agendarNovaTentativa();
          }
        });
      }

      await this.iniciarConsumoNoCanal(connection);
    } catch (erro) {
      this.rabbitmqConectado = Boolean(this.connection);
      this.filaDisponivel = false;
      logger.error("Não foi possível iniciar o consumo no RabbitMQ", {
        fila: this.fila,
        erro: erro instanceof Error ? erro.message : String(erro),
      });
      this.agendarNovaTentativa();
    } finally {
      this.conectando = false;
    }
  }

  private async iniciarConsumoNoCanal(connection: ChannelModel): Promise<void> {
    let channel: ConfirmChannel | undefined;
    try {
      // Canal com confirmação: a publicação de leituras na DLQ espera o ack do broker.
      channel = await connection.createConfirmChannel();
      const canalAtual = channel;

      canalAtual.on("error", (erro: Error) => {
        logger.error("Erro no canal do RabbitMQ", {
          fila: this.fila,
          erro: erro.message,
        });
      });

      canalAtual.on("close", () => {
        if (this.channel === canalAtual) {
          this.channel = undefined;
          this.filaDisponivel = false;
          this.agendarNovaTentativa();
        }
      });

      await canalAtual.checkQueue(this.fila);
      await canalAtual.prefetch(this.prefetch);

      await canalAtual.consume(
        this.fila,
        (msg) => {
          void this.tratarMensagem(canalAtual, msg);
        },
        { noAck: false },
      );

      this.channel = canalAtual;
      this.filaDisponivel = true;

      logger.info("Consumidor RabbitMQ iniciado com sucesso", {
        fila: this.fila,
        prefetch: this.prefetch,
      });
    } catch (erro) {
      this.channel = undefined;
      this.filaDisponivel = false;
      await channel?.close().catch(() => undefined);
      logger.warn("Fila de telemetria indisponível ou falha ao configurar canal; nova tentativa será agendada", {
        fila: this.fila,
        erro: erro instanceof Error ? erro.message : String(erro),
      });
      this.agendarNovaTentativa();
    }
  }

  private async tratarMensagem(
    channel: ConfirmChannel,
    msg: ConsumeMessage | null,
  ): Promise<void> {
    if (!msg) {
      if (this.channel === channel) {
        this.channel = undefined;
        this.filaDisponivel = false;
        logger.warn("Consumo cancelado pelo broker RabbitMQ", {
          fila: this.fila,
        });
        this.agendarNovaTentativa();
      }
      return;
    }

    try {
      const conteudo = msg.content.toString("utf-8");
      const evento = JSON.parse(conteudo) as EventoTelemetriaDTO;

      const resultado = await this.processarEvento(evento);

      // TASK 18.01: depois do COMMIT, publica as leituras de sensor inexistente na
      // DLQ (esperando a confirmação do broker) e registra as de sensor inativo.
      // No reenvio do mesmo evento as medidas não duplicam (UNIQUE sensor_id, unixtime),
      // mas a leitura inexistente pode ser publicada de novo na DLQ, o que é aceitável.
      await concluirLeiturasIgnoradas(evento, resultado, {
        publicarLeituraNaDlq: (dados) => this.publicarLeituraNaDlq(channel, dados),
      });

      // Confirma no RabbitMQ somente após o commit no banco e a confirmação da DLQ
      channel.ack(msg);
    } catch (erro) {
      logger.error("Falha ao processar mensagem da fila; ack não enviado", {
        fila: this.fila,
        erro: erro instanceof Error ? erro.message : String(erro),
      });
      try {
        channel.nack(msg, false, true);
      } catch {
        // Canal pode ter fechado durante o processamento
      }
    }
  }

  private publicarLeituraNaDlq(
    channel: ConfirmChannel,
    dados: { evento: EventoTelemetriaDTO; leitura: LeituraEventoDTO; motivo: string },
  ): Promise<void> {
    const conteudo = Buffer.from(
      JSON.stringify({
        // Distingue da mensagem do evento inteiro que o broker manda à DLQ após 3 entregas.
        tipo: TIPO_LEITURA_SENSOR_INEXISTENTE,
        motivo: dados.motivo,
        falhou_em: new Date().toISOString(),
        staging_id: dados.evento.staging_id,
        estacao_uuid: dados.evento.estacao_uuid,
        unixtime: dados.evento.unixtime,
        leitura: { sensor: dados.leitura.sensor, valor: dados.leitura.valor },
      }),
    );

    return new Promise<void>((resolve, reject) => {
      channel.publish(
        EXCHANGE_VALIDACAO_DLX,
        "",
        conteudo,
        {
          persistent: true,
          contentType: "application/json",
          headers: { "x-motivo": dados.motivo },
        },
        (erro) => (erro ? reject(erro) : resolve()),
      );
    });
  }

  private agendarNovaTentativa(): void {
    if (this.encerrando || this.reconectarTimer) {
      return;
    }

    this.reconectarTimer = setTimeout(() => {
      this.reconectarTimer = undefined;
      void this.conectarOuConfigurarCanal();
    }, this.reconectarMs);
  }
}

let consumidorAtivo: ConsumidorRabbitMqTelemetria | undefined;

export function configurarConsumidorTelemetria(
  consumidor: ConsumidorRabbitMqTelemetria | undefined,
): void {
  consumidorAtivo = consumidor;
}

export function obterEstadoSaudeConsumidor(): EstadoSaudeRabbitMq {
  if (!consumidorAtivo) {
    return {
      rabbitmq: "desconectado",
      fila: "indisponivel",
    };
  }
  return consumidorAtivo.obterEstadoSaude();
}

export async function encerrarConsumidorTelemetria(): Promise<void> {
  await consumidorAtivo?.encerrar();
  consumidorAtivo = undefined;
}
