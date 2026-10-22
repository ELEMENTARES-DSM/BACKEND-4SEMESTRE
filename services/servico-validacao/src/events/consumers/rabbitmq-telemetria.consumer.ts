import amqp, { Channel, ChannelModel, ConsumeMessage } from "amqplib";
import {
  EventoRecusadoDTO,
  EventoTelemetriaDTO,
  LeituraEventoDTO,
} from "../../dto/evento-telemetria.dto";
import {
  EventoMalformadoError,
  processarEventoTelemetria,
} from "../../services/processar-telemetria.service";
import { PublicadorDlqValidacao } from "../publishers/rabbitmq-dlq.publisher";
import {
  EVENTO_MALFORMADO,
  SENSOR_INEXISTENTE,
} from "../../validations/motivos-recusa";
import logger from "../../utils/logger";

export const FILA_VALIDACAO_TELEMETRIA = "validacao.telemetria";
export const PREFETCH_VALIDACAO_TELEMETRIA = 10;

export type ProcessadorEventoTelemetria = (
  evento: EventoTelemetriaDTO,
) => Promise<unknown>;

export type PublicadorDlq = (eventos: EventoRecusadoDTO[]) => Promise<void>;

export interface RabbitMqConsumerOptions {
  url: string;
  fila?: string;
  prefetch?: number;
  reconectarMs?: number;
  conectar?: (url: string) => Promise<ChannelModel>;
  processarEvento?: ProcessadorEventoTelemetria;
  publicarDlq?: PublicadorDlq;
  agora?: () => Date;
}

export interface EstadoSaudeRabbitMq {
  rabbitmq: "conectado" | "desconectado";
  fila: "disponivel" | "indisponivel";
}

export class ConsumidorRabbitMqTelemetria {
  private connection?: ChannelModel;
  private channel?: Channel;
  private reconectarTimer?: NodeJS.Timeout;
  private encerrando = false;
  private conectando = false;
  private rabbitmqConectado = false;
  private filaDisponivel = false;

  private readonly fila: string;
  private readonly prefetch: number;
  private readonly reconectarMs: number;
  private readonly processarEvento: ProcessadorEventoTelemetria;
  private readonly publicadorDlq = new PublicadorDlqValidacao(() => this.connection);
  private readonly publicarDlq: PublicadorDlq;
  private readonly agora: () => Date;

  constructor(private readonly options: RabbitMqConsumerOptions) {
    this.fila = options.fila ?? FILA_VALIDACAO_TELEMETRIA;
    this.prefetch = options.prefetch ?? PREFETCH_VALIDACAO_TELEMETRIA;
    this.reconectarMs = options.reconectarMs ?? 5000;
    this.processarEvento = options.processarEvento ?? processarEventoTelemetria;
    this.publicarDlq =
      options.publicarDlq ?? ((eventos) => this.publicadorDlq.publicar(eventos));
    this.agora = options.agora ?? (() => new Date());
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
    this.publicadorDlq.descartarCanal();

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
            this.publicadorDlq.descartarCanal();
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
    let channel: Channel | undefined;
    try {
      channel = await connection.createChannel();
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
    channel: Channel,
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

    const conteudo = msg.content.toString("utf-8");

    try {
      const evento = lerEvento(conteudo);
      const resultado = await this.processarEvento(evento);

      // US-18: cada leitura de sensor inexistente vai à DLQ como evento próprio.
      const recusadoEm = this.agora().toISOString();
      await this.publicarDlq(
        recusadasDoResultado(resultado).map((leitura) =>
          montarRecusaSensorInexistente(evento, leitura, recusadoEm),
        ),
      );

      // Confirma no RabbitMQ somente após o commit da transação no banco
      // e depois de o RabbitMQ confirmar as leituras recusadas na DLQ.
      channel.ack(msg);
    } catch (erro) {
      if (erro instanceof EventoMalformadoError) {
        await this.enviarMalformadoParaDlq(channel, msg, conteudo);
        return;
      }
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

  // US-18: evento sem estação, horário ou leituras utilizáveis vai inteiro
  // para a DLQ e é confirmado, sem nova tentativa e sem gastar o limite de entregas.
  private async enviarMalformadoParaDlq(
    channel: Channel,
    msg: ConsumeMessage,
    conteudo: string,
  ): Promise<void> {
    try {
      const recusa = montarRecusaMalformado(conteudo, this.agora().toISOString());
      await this.publicarDlq([recusa]);
      logger.warn("Evento malformado enviado para a validacao.dlq", {
        fila: this.fila,
        staging_id: recusa.staging_id,
      });
      channel.ack(msg);
    } catch (erro) {
      logger.error("Falha ao enviar evento malformado para a DLQ; ack não enviado", {
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

function lerEvento(conteudo: string): EventoTelemetriaDTO {
  try {
    return JSON.parse(conteudo) as EventoTelemetriaDTO;
  } catch {
    throw new EventoMalformadoError("Evento de telemetria não é JSON");
  }
}

function recusadasDoResultado(resultado: unknown): LeituraEventoDTO[] {
  if (resultado && typeof resultado === "object" && "recusadas" in resultado) {
    const { recusadas } = resultado as { recusadas: unknown };
    return Array.isArray(recusadas) ? (recusadas as LeituraEventoDTO[]) : [];
  }
  return [];
}

function montarRecusaSensorInexistente(
  evento: EventoTelemetriaDTO,
  leitura: LeituraEventoDTO,
  recusadoEm: string,
): EventoRecusadoDTO {
  return {
    staging_id: evento.staging_id,
    estacao_uuid: evento.estacao_uuid,
    unixtime: evento.unixtime,
    leituras: [leitura],
    motivo: SENSOR_INEXISTENTE,
    recusado_em: recusadoEm,
  };
}

// Guarda o que der para identificar e, em `leituras`, o conteúdo original.
function montarRecusaMalformado(conteudo: string, recusadoEm: string): EventoRecusadoDTO {
  let original: unknown = conteudo;
  try {
    original = JSON.parse(conteudo);
  } catch {
    // Não é JSON: segue como texto.
  }

  const campos =
    original && typeof original === "object" && !Array.isArray(original)
      ? (original as Record<string, unknown>)
      : {};

  return {
    staging_id: typeof campos.staging_id === "string" ? campos.staging_id : null,
    estacao_uuid: typeof campos.estacao_uuid === "string" ? campos.estacao_uuid : null,
    unixtime: typeof campos.unixtime === "number" ? campos.unixtime : null,
    leituras: original,
    motivo: EVENTO_MALFORMADO,
    recusado_em: recusadoEm,
  };
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
