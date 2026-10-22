import { Pool } from "pg";
import { pool } from "../config/db";
import {
  EventoTelemetriaDTO,
  LeituraEventoDTO,
  MedidaRow,
} from "../dto/evento-telemetria.dto";
import { inserirMedidaIdempotente } from "../repositories/medida.repository";
import { buscarSensoresPorEvento } from "../repositories/sensor.repository";
import { calibrarValor, valoresBrutosIguais } from "./calibracao.service";
import {
  metricasValidacaoService,
  MetricasValidacaoService,
} from "./metricas-validacao.service";
import logger from "../utils/logger";

export const SENSOR_INATIVO = "Inativo";

export interface OpcoesProcessarTelemetria {
  dbPool?: Pick<Pool, "connect">;
  agora?: () => Date;
  metricas?: Pick<MetricasValidacaoService, "incrementarIgnoradasSensorInativo">;
}

export interface ResultadoProcessamentoEvento {
  inseridas: number;
  duplicadasIdempotentes: number;
  duplicadasDivergentes: number;
  medidas: MedidaRow[];
  // US-18: leituras de sensor que não existe na estação, para a DLQ.
  recusadas: LeituraEventoDTO[];
  // US-18: leituras de sensor inativo, só em log e no contador.
  ignoradasSensorInativo: number;
}

/**
 * Evento sem estação, horário ou lista de leituras utilizável (US-18).
 * Não adianta tentar de novo: o evento vai inteiro para a DLQ.
 */
export class EventoMalformadoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventoMalformadoError";
  }
}

function validarEstruturaEvento(evento: EventoTelemetriaDTO): void {
  if (
    !evento ||
    typeof evento !== "object" ||
    typeof evento.staging_id !== "string" ||
    evento.staging_id.trim() === "" ||
    typeof evento.estacao_uuid !== "string" ||
    evento.estacao_uuid.trim() === "" ||
    typeof evento.unixtime !== "number" ||
    !Number.isFinite(evento.unixtime) ||
    !Array.isArray(evento.leituras) ||
    evento.leituras.length === 0
  ) {
    throw new EventoMalformadoError("Evento de telemetria inválido");
  }

  for (const leitura of evento.leituras) {
    if (
      !leitura ||
      typeof leitura.sensor !== "string" ||
      leitura.sensor.trim() === "" ||
      typeof leitura.valor !== "number" ||
      !Number.isFinite(leitura.valor)
    ) {
      throw new EventoMalformadoError("Leitura do evento de telemetria inválida");
    }
  }
}

/**
 * Processa um evento da fila validacao.telemetria em uma única transação de banco:
 * - Busca os sensores da estação em uma única consulta SQL (sem cache).
 * - US-18: leitura de sensor inexistente na estação é devolvida em `recusadas`
 *   (o consumidor a envia à DLQ); de sensor inativo é ignorada, com log e contador.
 * - Calibra cada leitura válida: (bruto * fator) + ganho em BigInt escala 6 com HALF_UP para 2 casas.
 * - Persiste cada leitura válida em `medidas` com o unixtime da estação e criado_em em UTC.
 * - Garante idempotência por UNIQUE (sensor_id, unixtime): mantém a primeira medida e,
 *   se o valor bruto divergir, registra a divergência em log.
 */
export const processarEventoTelemetria = async (
  evento: EventoTelemetriaDTO,
  opcoes: OpcoesProcessarTelemetria = {},
): Promise<ResultadoProcessamentoEvento> => {
  validarEstruturaEvento(evento);

  const dbPool = opcoes.dbPool ?? pool;
  const obterAgora = opcoes.agora ?? (() => new Date());
  const metricas = opcoes.metricas ?? metricasValidacaoService;
  const client = await dbPool.connect();

  try {
    await client.query("BEGIN");

    const codigos = evento.leituras.map((item) => item.sensor);
    const sensoresPorCodigo = await buscarSensoresPorEvento(
      evento.estacao_uuid,
      codigos,
      client,
    );

    const criadoEm = obterAgora();
    let inseridas = 0;
    let duplicadasIdempotentes = 0;
    let duplicadasDivergentes = 0;
    const medidas: MedidaRow[] = [];
    const recusadas: LeituraEventoDTO[] = [];
    const ignoradas: LeituraEventoDTO[] = [];

    for (const leitura of evento.leituras) {
      const sensor = sensoresPorCodigo.get(leitura.sensor);
      // Código que existe só em outra estação também cai aqui: a busca é por estação.
      if (!sensor) {
        recusadas.push({ sensor: leitura.sensor, valor: leitura.valor });
        continue;
      }

      if (sensor.status === SENSOR_INATIVO) {
        ignoradas.push(leitura);
        continue;
      }

      const valorCalibrado = calibrarValor(
        leitura.valor,
        sensor.fator,
        sensor.ganho,
      );

      const resultado = await inserirMedidaIdempotente(
        {
          sensor_id: sensor.id,
          unixtime: evento.unixtime,
          valor_bruto: leitura.valor,
          valor: valorCalibrado,
          valida: true,
          staging_id: evento.staging_id,
          criado_em: criadoEm,
        },
        client,
      );

      medidas.push(resultado.medida);

      if (resultado.inserida) {
        inseridas += 1;
      } else if (
        valoresBrutosIguais(resultado.medida.valor_bruto, leitura.valor)
      ) {
        duplicadasIdempotentes += 1;
      } else {
        duplicadasDivergentes += 1;
        logger.warn(
          "Divergência de valor bruto em leitura duplicada; mantendo o primeiro registro",
          {
            staging_id: evento.staging_id,
            staging_id_existente: resultado.medida.staging_id,
            estacao_uuid: evento.estacao_uuid,
            sensor_id: sensor.id,
            sensor_codigo: sensor.codigo,
            unixtime: evento.unixtime,
            valor_bruto_existente: resultado.medida.valor_bruto,
            valor_bruto_recebido: leitura.valor,
          },
        );
      }
    }

    await client.query("COMMIT");

    // Registra as ignoradas só depois do COMMIT: se a transação falhar, o
    // evento volta para a fila e elas são registradas na nova entrega.
    for (const leitura of ignoradas) {
      logger.warn("Leitura ignorada: sensor inativo", {
        estacao_uuid: evento.estacao_uuid,
        sensor_codigo: leitura.sensor,
        unixtime: evento.unixtime,
        valor_bruto: leitura.valor,
      });
    }
    if (ignoradas.length > 0) {
      metricas.incrementarIgnoradasSensorInativo(ignoradas.length);
    }

    return {
      inseridas,
      duplicadasIdempotentes,
      duplicadasDivergentes,
      medidas,
      recusadas,
      ignoradasSensorInativo: ignoradas.length,
    };
  } catch (erro) {
    await client.query("ROLLBACK").catch(() => undefined);
    logger.error("Falha ao processar evento de telemetria", {
      staging_id: evento?.staging_id,
      estacao_uuid: evento?.estacao_uuid,
      unixtime: evento?.unixtime,
      erro: erro instanceof Error ? erro.message : String(erro),
    });
    throw erro;
  } finally {
    client.release();
  }
};
