import amqp, { Channel, ChannelModel, ConsumeMessage } from "amqplib";
import { verificarConexaoBanco } from "../../config/db";
import { registrarAvisos } from "../../services/avisar-gestores.service";
import { enviarAvisos } from "../../services/enviar-aviso.service";
import {
  EventoAlarmeDisparado,
  eventoAlarmeSchema,
} from "../../validations/evento-alarme.validation";
import logger from "../../utils/logger";
import { ehBancoIndisponivel } from "../../utils/erro-banco";

// Mesmo contrato do servico-validacao (rabbitmq-alarme.publisher.ts): nomes e
// argumentos iguais, senão o RabbitMQ recusa a declaração (PRECONDITION_FAILED).
export const EXCHANGE_ALARME_DISPARADO = "alarme.disparado";
export const FILA_NOTIFICACAO_ALARMES = "notificacao.alarmes";
export const EXCHANGE_NOTIFICACAO_DLX = "notificacao.dlx";
export const FILA_NOTIFICACAO_DLQ = "notificacao.dlq";
export const ARGUMENTOS_FILA_NOTIFICACAO = {
  "x-queue-type": "quorum",
  "x-delivery-limit": 3,
  "x-dead-letter-exchange": EXCHANGE_NOTIFICACAO_DLX,
} as const;
export const PREFETCH_NOTIFICACAO = 5;
// Intervalo entre as conferências do banco com o consumo pausado.
export const ESPERA_BANCO_MS = 10000;

/** Declara a topologia de forma idempotente: o consumidor pode subir antes do publicador. */
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

/** `enviarParaDlq`: o processamento terminou, mas o evento deve ir para a notificacao.dlq. */
export type ResultadoProcessamentoAlarme = { enviarParaDlq?: boolean } | void;

export type ProcessadorEventoAlarme = (
  evento: EventoAlarmeDisparado,
) => Promise<ResultadoProcessamentoAlarme>;

export interface OpcoesConsumidorAlarmes {
  url: string;
  prefetch?: number;
  reconectarMs?: number;
  esperaBancoMs?: number;
  conectar?: (url: string) => Promise<ChannelModel>;
  processarEvento?: ProcessadorEventoAlarme;
  verificarBanco?: () => Promise<boolean>;
}

export function lerEventoAlarme(conteudo: string): EventoAlarmeDisparado | null {
  try {
    const resultado = eventoAlarmeSchema.safeParse(JSON.parse(conteudo));
    return resultado.success ? resultado.data : null;
  } catch {
    return null;
  }
}

/**
 * Registra um aviso por gestor e envia por e-mail; se algum destinatário esgotar
 * as 3 tentativas, o evento vai para a notificacao.dlq e o alarme continua gravado.
 */
export const processarEventoAlarme: ProcessadorEventoAlarme = async (evento) => {
  const avisos = await registrarAvisos(evento);
  const resultado = await enviarAvisos(evento, avisos);
  return { enviarParaDlq: resultado.falharam > 0 };
};

/**
 * US-23: consome alarme.disparado e avisa os gestores. Confirma a mensagem só
 * depois do processamento; evento malformado vai para a notificacao.dlq sem nova
 * tentativa; com o banco fora do ar, para de consumir até ele voltar.
 */
export class ConsumidorRabbitMqAlarmes {
  private connection?: ChannelModel;
  private channel?: Channel;
  private reconectarTimer?: NodeJS.Timeout;
  private verificacaoBancoTimer?: NodeJS.Timeout;
  private consumoPausado = false;
  private encerrando = false;
  private conectando = false;

  private readonly prefetch: number;
  private readonly reconectarMs: number;
  private readonly esperaBancoMs: number;
  private readonly processarEvento: ProcessadorEventoAlarme;
  private readonly verificarBanco: () => Promise<boolean>;

  constructor(private readonly options: OpcoesConsumidorAlarmes) {
    this.prefetch = options.prefetch ?? PREFETCH_NOTIFICACAO;
    this.reconectarMs = options.reconectarMs ?? 5000;
    this.esperaBancoMs = options.esperaBancoMs ?? ESPERA_BANCO_MS;
    this.processarEvento = options.processarEvento ?? processarEventoAlarme;
    this.verificarBanco = options.verificarBanco ?? verificarConexaoBanco;
  }

  public async iniciar(): Promise<void> {
    this.encerrando = false;
    await this.conectarOuConfigurarCanal();
  }

  public async encerrar(): Promise<void> {
    this.encerrando = true;
    clearTimeout(this.reconectarTimer);
    clearTimeout(this.verificacaoBancoTimer);
    this.reconectarTimer = undefined;
    this.verificacaoBancoTimer = undefined;

    const channel = this.channel;
    const connection = this.connection;
    this.channel = undefined;
    this.connection = undefined;
    await channel?.close().catch(() => undefined);
    await connection?.close().catch(() => undefined);
  }

  public estaSaudavel(): boolean {
    return Boolean(this.connection && this.channel);
  }

  public estaComConsumoPausado(): boolean {
    return this.consumoPausado;
  }

  private async conectarOuConfigurarCanal(): Promise<void> {
    if (this.encerrando || this.conectando || this.consumoPausado) {
      return;
    }

    this.conectando = true;
    try {
      let connection = this.connection;
      if (!connection) {
        const conectar = this.options.conectar ?? amqp.connect;
        connection = await conectar(this.options.url);
        this.connection = connection;

        connection.on("error", (erro: Error) => {
          logger.error("Erro na conexão com o RabbitMQ", { erro: erro.message });
        });
        connection.on("close", () => {
          if (this.connection === connection) {
            this.connection = undefined;
            this.channel = undefined;
            logger.warn("Conexão com o RabbitMQ encerrada", { fila: FILA_NOTIFICACAO_ALARMES });
            this.agendarNovaTentativa();
          }
        });
      }

      await this.iniciarConsumoNoCanal(connection);
    } catch (erro) {
      logger.error("Não foi possível iniciar o consumo de alarme.disparado", {
        fila: FILA_NOTIFICACAO_ALARMES,
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
        logger.error("Erro no canal do RabbitMQ", { fila: FILA_NOTIFICACAO_ALARMES, erro: erro.message });
      });
      canalAtual.on("close", () => {
        if (this.channel === canalAtual) {
          this.channel = undefined;
          this.agendarNovaTentativa();
        }
      });

      await declararTopologiaAlarmes(canalAtual);
      await canalAtual.prefetch(this.prefetch);
      await canalAtual.consume(
        FILA_NOTIFICACAO_ALARMES,
        (msg) => {
          void this.tratarMensagem(canalAtual, msg);
        },
        { noAck: false },
      );

      this.channel = canalAtual;
      logger.info("Consumidor de alarme.disparado iniciado", {
        fila: FILA_NOTIFICACAO_ALARMES,
        prefetch: this.prefetch,
      });
    } catch (erro) {
      this.channel = undefined;
      await channel?.close().catch(() => undefined);
      logger.warn("Falha ao configurar o canal de alarme.disparado; nova tentativa será agendada", {
        fila: FILA_NOTIFICACAO_ALARMES,
        erro: erro instanceof Error ? erro.message : String(erro),
      });
      this.agendarNovaTentativa();
    }
  }

  private async tratarMensagem(channel: Channel, msg: ConsumeMessage | null): Promise<void> {
    if (!msg) {
      if (this.channel === channel) {
        this.channel = undefined;
        logger.warn("Consumo cancelado pelo broker RabbitMQ", { fila: FILA_NOTIFICACAO_ALARMES });
        this.agendarNovaTentativa();
      }
      return;
    }

    const evento = lerEventoAlarme(msg.content.toString("utf-8"));
    if (!evento) {
      // Tentar de novo não conserta: vai direto para a notificacao.dlq.
      logger.warn("Evento alarme.disparado malformado enviado para a notificacao.dlq", {
        fila: FILA_NOTIFICACAO_ALARMES,
        messageId: msg.properties.messageId,
      });
      this.rejeitar(channel, msg, false);
      return;
    }

    try {
      const resultado = await this.processarEvento(evento);
      if (resultado && resultado.enviarParaDlq) {
        this.rejeitar(channel, msg, false);
        return;
      }
      channel.ack(msg);
    } catch (erro) {
      if (ehBancoIndisponivel(erro)) {
        await this.pausarPorBancoIndisponivel(channel, erro);
        return;
      }
      logger.error("Falha ao processar alarme.disparado; o evento volta para a fila", {
        alarme_id: evento.alarme_id,
        erro: erro instanceof Error ? erro.message : String(erro),
      });
      this.rejeitar(channel, msg, true);
    }
  }

  private rejeitar(channel: Channel, msg: ConsumeMessage, devolverAFila: boolean): void {
    try {
      channel.nack(msg, false, devolverAFila);
    } catch {
      // Canal pode ter fechado durante o processamento
    }
  }

  // Fechar o canal devolve à fila os eventos em processamento; os que chegam
  // depois esperam na fila até o banco voltar.
  private async pausarPorBancoIndisponivel(channel: Channel, erro: unknown): Promise<void> {
    if (this.consumoPausado) {
      return;
    }

    this.consumoPausado = true;
    logger.error("Banco de dados indisponível; consumo de alarme.disparado pausado", {
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
      this.agendarVerificacaoBanco();
      return;
    }

    this.consumoPausado = false;
    logger.info("Banco de dados respondeu; consumo de alarme.disparado retomado");
    await this.conectarOuConfigurarCanal();
  }

  private agendarNovaTentativa(): void {
    if (this.encerrando || this.reconectarTimer || this.consumoPausado) {
      return;
    }

    this.reconectarTimer = setTimeout(() => {
      this.reconectarTimer = undefined;
      void this.conectarOuConfigurarCanal();
    }, this.reconectarMs);
  }
}
