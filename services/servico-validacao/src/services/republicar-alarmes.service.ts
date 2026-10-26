import { AlarmeRow } from "../dto/alarme.dto";
import {
  buscarAlarmesNaoPublicados,
  marcarAlarmesPublicados,
} from "../repositories/alarme.repository";
import logger from "../utils/logger";

// US-22: intervalo entre as tentativas enquanto sobrar alarme sem publicação.
export const ESPERA_REPUBLICAR_ALARMES_MS = 10000;
export const LOTE_REPUBLICAR_ALARMES = 100;

export interface OpcoesRepublicadorAlarmes {
  publicar: (alarmes: AlarmeRow[]) => Promise<void>;
  buscarPendentes?: (limite: number) => Promise<AlarmeRow[]>;
  marcarPublicados?: (ids: string[], publicadoEm: Date) => Promise<void>;
  agora?: () => Date;
  esperaMs?: number;
  lote?: number;
}

/**
 * Publica os alarmes que ficaram sem confirmação do RabbitMQ (o canal caiu entre
 * o commit e a publicação). Roda quando o consumidor conecta ou reconecta e,
 * depois de uma falha, de novo após `esperaMs`, até não sobrar pendente.
 */
export class RepublicadorAlarmes {
  private timer?: NodeJS.Timeout;
  private executando?: Promise<void>;
  private encerrado = false;

  private readonly buscarPendentes: (limite: number) => Promise<AlarmeRow[]>;
  private readonly marcarPublicados: (ids: string[], publicadoEm: Date) => Promise<void>;
  private readonly agora: () => Date;
  private readonly esperaMs: number;
  private readonly lote: number;

  constructor(private readonly options: OpcoesRepublicadorAlarmes) {
    this.buscarPendentes = options.buscarPendentes ?? ((limite) => buscarAlarmesNaoPublicados(limite));
    this.marcarPublicados =
      options.marcarPublicados ?? ((ids, publicadoEm) => marcarAlarmesPublicados(ids, publicadoEm));
    this.agora = options.agora ?? (() => new Date());
    this.esperaMs = options.esperaMs ?? ESPERA_REPUBLICAR_ALARMES_MS;
    this.lote = options.lote ?? LOTE_REPUBLICAR_ALARMES;
  }

  public agendar(atrasoMs = 0): void {
    if (this.encerrado || this.timer) {
      return;
    }

    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.executar();
    }, atrasoMs);
  }

  /** Uma execução por vez; quem chama durante outra espera a mesma. */
  public executar(): Promise<void> {
    if (!this.executando) {
      this.executando = this.republicar().finally(() => {
        this.executando = undefined;
      });
    }
    return this.executando;
  }

  public encerrar(): void {
    this.encerrado = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private async republicar(): Promise<void> {
    try {
      for (;;) {
        const pendentes = await this.buscarPendentes(this.lote);
        if (pendentes.length === 0) {
          return;
        }

        await this.options.publicar(pendentes);
        await this.marcarPublicados(
          pendentes.map((alarme) => alarme.id),
          this.agora(),
        );
        logger.info("Alarmes pendentes publicados em alarme.disparado", {
          quantidade: pendentes.length,
        });

        if (pendentes.length < this.lote) {
          return;
        }
      }
    } catch (erro) {
      logger.warn("Alarmes continuam sem publicação; nova tentativa agendada", {
        novaTentativaEmMs: this.esperaMs,
        erro: erro instanceof Error ? erro.message : String(erro),
      });
      this.agendar(this.esperaMs);
    }
  }
}
