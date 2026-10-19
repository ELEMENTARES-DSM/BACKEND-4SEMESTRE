/**
 * Parte 2 (após o merge do ELEM-97): no processarEventoTelemetria, trocar o erro
 * de 'sensor ativo não encontrado' por esta função; seguirParaUS17 = calibrar e
 * gravar em medidas_validadas; enviarLeituraParaDlq = publicar a leitura na
 * validacao.dlx. Para ler o sensor dentro da mesma transação, passar o client da
 * transação como db do buscarSensorDaEstacao:
 *   buscarSensor: (estacaoId, codigo) => buscarSensorDaEstacao(estacaoId, codigo, client)
 */

import { EventoTelemetria } from "../dto/evento-telemetria.dto";
import {
  BuscarSensor,
  classificarLeituras,
  LeituraComSensor,
  LeituraEvento,
} from "./classificar-leituras.service";
import { registrarLeituraSensorInativo } from "./registro-sensor-inativo.service";

export const MOTIVO_SENSOR_INEXISTENTE = "Sensor inexistente na estação";

export type SeguirParaUS17 = (
  validas: LeituraComSensor[],
  evento: EventoTelemetria,
) => Promise<void>;

export type EnviarLeituraParaDlq = (
  leitura: LeituraEvento,
  evento: EventoTelemetria,
  motivo: string,
) => Promise<void>;

export interface ProcessarLeiturasDeps {
  seguirParaUS17: SeguirParaUS17;
  enviarLeituraParaDlq: EnviarLeituraParaDlq;
  buscarSensor?: BuscarSensor;
  registrarInativa?: typeof registrarLeituraSensorInativo;
}

export interface ResultadoProcessamentoLeituras {
  gravadas: number;
  ignoradasInativas: number;
  enviadasDlq: number;
}

export async function processarLeiturasDoEvento(
  evento: EventoTelemetria,
  deps: ProcessarLeiturasDeps,
): Promise<ResultadoProcessamentoLeituras> {
  const registrarInativa = deps.registrarInativa ?? registrarLeituraSensorInativo;

  const { validas, inativas, inexistentes } = await classificarLeituras(evento, {
    buscarSensor: deps.buscarSensor,
  });

  if (validas.length > 0) {
    await deps.seguirParaUS17(validas, evento);
  }

  for (const leitura of inexistentes) {
    await deps.enviarLeituraParaDlq(leitura, evento, MOTIVO_SENSOR_INEXISTENTE);
  }

  // Por último: se a gravação ou a DLQ falharem, o evento é reprocessado e as
  // inativas seriam contadas duas vezes se o registro viesse antes.
  for (const { leitura } of inativas) {
    registrarInativa({
      estacaoId: evento.estacao_uuid,
      codigo: leitura.sensor,
      unixtime: evento.unixtime,
      valorBruto: leitura.valor,
    });
  }

  return {
    gravadas: validas.length,
    ignoradasInativas: inativas.length,
    enviadasDlq: inexistentes.length,
  };
}
