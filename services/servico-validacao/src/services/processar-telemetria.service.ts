import { Pool } from "pg";
import { pool } from "../config/db";
import {
  EventoTelemetriaDTO,
  LeituraEventoDTO,
  MedidaRow,
  SensorEventoRow,
} from "../dto/evento-telemetria.dto";
import { inserirMedidaIdempotente } from "../repositories/medida.repository";
import { buscarSensoresPorEvento } from "../repositories/sensor.repository";
import { calibrarValor, valoresBrutosIguais } from "./calibracao.service";
import logger from "../utils/logger";

export interface OpcoesProcessarTelemetria {
  dbPool?: Pick<Pool, "connect">;
  agora?: () => Date;
}

export interface ResultadoProcessamentoEvento {
  inseridas: number;
  duplicadasIdempotentes: number;
  duplicadasDivergentes: number;
  medidas: MedidaRow[];
  inativas: Array<{ leitura: LeituraEventoDTO; sensor: SensorEventoRow }>;
  inexistentes: LeituraEventoDTO[];
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
    throw new Error("Evento de telemetria inválido");
  }

  for (const leitura of evento.leituras) {
    if (
      !leitura ||
      typeof leitura.sensor !== "string" ||
      leitura.sensor.trim() === "" ||
      typeof leitura.valor !== "number" ||
      !Number.isFinite(leitura.valor)
    ) {
      throw new Error("Leitura do evento de telemetria inválida");
    }
  }
}

/**
 * Processa um evento da fila validacao.telemetria em uma única transação de banco:
 * - Busca os sensores da estação em uma única consulta SQL (sem cache): o status é
 *   lido a cada evento, então um sensor reativado volta a gerar medidas.
 * - TASK 18.01: leitura de sensor inexistente vai para `inexistentes` e leitura de
 *   sensor inativo vai para `inativas`; nenhuma delas é calibrada nem gravada e o
 *   evento segue com as demais. Log/contador de inativas e publicação na DLQ ficam
 *   fora da transação (concluirLeiturasIgnoradas, chamado pelo consumidor após o COMMIT).
 * - Calibra cada leitura de sensor ativo: (bruto * fator) + ganho em BigInt escala 6 com HALF_UP para 2 casas.
 * - Persiste cada leitura em `medidas` com o unixtime da estação e criado_em em UTC.
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
    const inativas: ResultadoProcessamentoEvento["inativas"] = [];
    const inexistentes: LeituraEventoDTO[] = [];

    for (const leitura of evento.leituras) {
      const sensor = sensoresPorCodigo.get(leitura.sensor);
      if (!sensor) {
        inexistentes.push(leitura);
        continue;
      }
      if (sensor.status !== "Ativo") {
        inativas.push({ leitura, sensor });
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

    return {
      inseridas,
      duplicadasIdempotentes,
      duplicadasDivergentes,
      medidas,
      inativas,
      inexistentes,
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
