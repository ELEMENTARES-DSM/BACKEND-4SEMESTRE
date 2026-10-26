import amqp, { Channel, ChannelModel, ConsumeMessage } from "amqplib";
import { verificarConexaoBanco } from "../../config/db";
import {
  EventoRecusadoDTO,
  EventoTelemetriaDTO,
  LeituraEventoDTO,
} from "../../dto/evento-telemetria.dto";
import { AlarmeRow } from "../../dto/alarme.dto";
import {
  EventoMalformadoError,
  processarEventoTelemetria,
} from "../../services/processar-telemetria.service";
import { PublicadorDlqValidacao } from "../publishers/rabbitmq-dlq.publisher";
import { PublicadorAlarmes } from "../publishers/rabbitmq-alarme.publisher";
import { marcarAlarmesPublicados } from "../../repositories/alarme.repository";
import {
  EVENTO_MALFORMADO,
  SENSOR_INEXISTENTE,
} from "../../validations/motivos-recusa";
import logger from "../../utils/logger";
import { ehBancoIndisponivel } from "../../utils/erro-banco";

export const FILA_VALIDACAO_TELEMETRIA = "validacao.telemetria";
export const PREFETCH_VALIDACAO_TELEMETRIA = 10;
// US-20: intervalo entre as conferências do banco com o consumo pausado.
export const ESPERA_BANCO_MS = 10000;

export type ProcessadorEventoTelemetria = (
  evento: EventoTelemetriaDTO,
) => Promise<unknown>;

export type PublicadorDlq = (eventos: EventoRecusadoDTO[]) => Promise<void>;

export type PublicadorAlarmesFn = (alarmes: AlarmeRow[]) => Promise<void>;

export interface RabbitMqConsumerOptions {
  url: string;
  fila?: string;
  prefetch?: number;
  reconectarMs?: number;
  conectar?: (url: string) => Promise<ChannelModel>;
  processarEvento?: ProcessadorEventoTelemetria;
  publicarDlq?: PublicadorDlq;
  agora?: () => Date;
  verificarBanco?: () => Promise<boolean>;
  esperaBancoMs?: number;
  // US-22: publicação de alarme.disparado e aviso de que há alarme a republicar
  // (ao conectar e quando a publicação falha).
  publicarAlarmes?: PublicadorAlarmesFn;
  marcarAlarmesPublicados?: (ids: string[], publicadoEm: Date) => Promise<void>;
  agendarRepublicacaoAlarmes?: () => void;
}

export interface EstadoSaudeRabbitMq {
  rabbitmq: "conectado" | "desconectado";
  fila: "disponivel" | "indisponivel";
}

export class ConsumidorRabbitMqTelemetria {
  private connection?: ChannelModel;
  private channel?: Channel;
  private reconectarTimer?: NodeJS.Timeout;
  private verificacaoBancoTimer?: NodeJS.Timeout;
  private consumoPausado = false;
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
  private readonly publicadorAlarmes = new PublicadorAlarmes(() => this.connection);
  private readonly publicarAlarmesFn: PublicadorAlarmesFn;
  private readonly marcarPublicados: (ids: string[], publicadoEm: Date) => Promise<void>;
  private readonly agora: () => Date;
  private readonly verificarBanco: () => Promise<boolean>;
  private readonly esperaBancoMs: number;

  constructor(private readonly options: RabbitMqConsumerOptions) {
    this.fila = options.fila ?? FILA_VALIDACAO_TELEMETRIA;
    this.prefetch = options.prefetch ?? PREFETCH_VALIDACAO_TELEMETRIA;
    this.reconectarMs = options.reconectarMs ?? 5000;
    this.processarEvento = options.processarEvento ?? processarEventoTelemetria;
    this.publicarDlq =
      options.publicarDlq ?? ((eventos) => this.publicadorDlq.publicar(eventos));
    this.agora = options.agora ?? (() => new Date());
    this.verificarBanco = options.verificarBanco ?? verificarConexaoBanco;
    this.esperaBancoMs = options.esperaBancoMs ?? ESPERA_BANCO_MS;
    this.publicarAlarmesFn =
      options.publicarAlarmes ?? ((alarmes) => this.publicadorAlarmes.publicar(alarmes));
    this.marcarPublicados =
      options.marcarAlarmesPublicados ??
      ((ids, publicadoEm) => marcarAlarmesPublicados(ids, publicadoEm));
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
    if (this.verificacaoBancoTimer) {
      clearTimeout(this.verificacaoBancoTimer);
      this.verificacaoBancoTimer = undefined;
    }

    const channel = this.channel;
    const connection = this.connection;
    this.channel = undefined;
    this.connection = undefined;
    this.rabbitmqConectado = false;
    this.filaDisponivel = false;
    this.publicadorDlq.descartarCanal();
    this.publicadorAlarmes.descartarCanal();

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

  /** US-20: verdadeiro enquanto o consumo espera o banco voltar. */
  public estaComConsumoPausado(): boolean {
    return this.consumoPausado;
  }

  /** US-22: publica em alarme.disparado pela conexão do consumidor. */
  public publicarAlarmes(alarmes: AlarmeRow[]): Promise<void> {
    return this.publicarAlarmesFn(alarmes);
  }

  private async conectarOuConfigurarCanal(): Promise<void> {
    if (this.encerrando || this.conectando || this.consumoPausado) {
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
            this.publicadorAlarmes.descartarCanal();
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
      this.options.agendarRepublicacaoAlarmes?.();
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

      // US-22: a medida já foi gravada; se a publicação do alarme falhar, ele fica
      // pendente e é republicado depois, sem devolver o evento à fila.
      await this.publicarAlarmesDoEvento(alarmesDoResultado(resultado));

      // Confirma no RabbitMQ somente após o commit da transação no banco
      // e depois de o RabbitMQ confirmar as leituras recusadas na DLQ.
      channel.ack(msg);
    } catch (erro) {
      if (erro instanceof EventoMalformadoError) {
        await this.enviarMalformadoParaDlq(channel, msg, conteudo);
        return;
      }
      if (ehBancoIndisponivel(erro)) {
        await this.pausarPorBancoIndisponivel(channel, erro);
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

  private async publicarAlarmesDoEvento(alarmes: AlarmeRow[]): Promise<void> {
    if (alarmes.length === 0) {
      return;
    }

    try {
      await this.publicarAlarmesFn(alarmes);
      await this.marcarPublicados(
        alarmes.map((alarme) => alarme.id),
        this.agora(),
      );
    } catch (erro) {
      logger.error("Falha ao publicar alarme.disparado; alarme fica pendente de publicação", {
        alarmes: alarmes.map((alarme) => alarme.id),
        erro: erro instanceof Error ? erro.message : String(erro),
      });
      this.options.agendarRepublicacaoAlarmes?.();
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

  // US-20: com o banco fora do ar, para de consumir em vez de devolver evento
  // por evento. Fechar o canal devolve à fila, inteiros e sem confirmação, todos
  // os eventos em processamento; os que chegam depois esperam na fila sem serem
  // entregues e, por isso, não gastam o limite de entregas.
  private async pausarPorBancoIndisponivel(channel: Channel, erro: unknown): Promise<void> {
    if (this.consumoPausado) {
      return;
    }

    this.consumoPausado = true;
    logger.error("Banco de dados indisponível; consumo pausado até o banco responder", {
      fila: this.fila,
      novaTentativaEmMs: this.esperaBancoMs,
      erro: erro instanceof Error ? erro.message : String(erro),
    });

    if (this.channel === channel) {
      this.channel = undefined;
    }
    await channel.close().catch(() => undefined);
    this.agendarVerificacaoBanco();
  }

  private agendarVerificacaoBanco(): void {
    if (this.encerrando || this.verificacaoBancoTimer) {
      return;
    }

    this.verificacaoBancoTimer = setTimeout(() => {
      this.verificacaoBancoTimer = undefined;
      void this.retomarSeBancoResponder();
    }, this.esperaBancoMs);
  }

  private async retomarSeBancoResponder(): Promise<void> {
    if (this.encerrando) {
      return;
    }

    const bancoNoAr = await this.verificarBanco().catch(() => false);
    if (!bancoNoAr) {
      logger.warn("Banco de dados continua indisponível; consumo segue pausado", {
        fila: this.fila,
        novaTentativaEmMs: this.esperaBancoMs,
      });
      this.agendarVerificacaoBanco();
      return;
    }

    this.consumoPausado = false;
    logger.info("Banco de dados respondeu; consumo retomado", { fila: this.fila });
    await this.conectarOuConfigurarCanal();
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

function alarmesDoResultado(resultado: unknown): AlarmeRow[] {
  if (resultado && typeof resultado === "object" && "alarmesAbertos" in resultado) {
    const { alarmesAbertos } = resultado as { alarmesAbertos: unknown };
    return Array.isArray(alarmesAbertos) ? (alarmesAbertos as AlarmeRow[]) : [];
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
