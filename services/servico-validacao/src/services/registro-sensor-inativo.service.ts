/**
 * Registro das leituras ignoradas por sensor inativo (TASK 18.01).
 * WARN: não é erro do evento, mas indica estação enviando dado de sensor desativado.
 */

import { logger, Logger } from "../utils/logger";
import {
  sensorInativoMetricsService,
  SensorInativoMetricsService,
} from "./sensor-inativo-metrics.service";

export const MENSAGEM_LEITURA_SENSOR_INATIVO = "Leitura ignorada: sensor inativo";

export interface DadosLeituraSensorInativo {
  estacaoId: string;
  codigo: string;
  unixtime: number;
  valorBruto: number;
}

export interface RegistroSensorInativoDeps {
  logger?: Pick<Logger, "warn">;
  metricas?: Pick<SensorInativoMetricsService, "incrementar">;
}

export function registrarLeituraSensorInativo(
  dados: DadosLeituraSensorInativo,
  deps: RegistroSensorInativoDeps = {},
): void {
  const log = deps.logger ?? logger;
  const metricas = deps.metricas ?? sensorInativoMetricsService;

  log.warn(MENSAGEM_LEITURA_SENSOR_INATIVO, {
    estacaoId: dados.estacaoId,
    codigo: dados.codigo,
    horario: new Date(dados.unixtime * 1000).toISOString(),
    valorBruto: dados.valorBruto,
  });
  metricas.incrementar();
}

export default registrarLeituraSensorInativo;
