/**
 * TASK 18.01: conclui as leituras que o processarEventoTelemetria não gravou.
 * Chamado pelo consumidor depois do COMMIT e antes do ack:
 * - sensor inexistente: só essa leitura é publicada na validacao.dlx (→ validacao.dlq);
 * - sensor inativo: não vai para a DLQ; log WARN + contador.
 */

import {
  EventoTelemetriaDTO,
  LeituraEventoDTO,
} from "../dto/evento-telemetria.dto";
import type { ResultadoProcessamentoEvento } from "./processar-telemetria.service";
import { registrarLeituraSensorInativo } from "./registro-sensor-inativo.service";

export const MOTIVO_SENSOR_INEXISTENTE = "Sensor inexistente na estação";

export type PublicarLeituraNaDlq = (dados: {
  evento: EventoTelemetriaDTO;
  leitura: LeituraEventoDTO;
  motivo: string;
}) => Promise<void>;

export interface ConcluirLeiturasIgnoradasDeps {
  publicarLeituraNaDlq: PublicarLeituraNaDlq;
  registrarInativa?: typeof registrarLeituraSensorInativo;
}

export async function concluirLeiturasIgnoradas(
  evento: EventoTelemetriaDTO,
  resultado: Pick<ResultadoProcessamentoEvento, "inativas" | "inexistentes">,
  deps: ConcluirLeiturasIgnoradasDeps,
): Promise<void> {
  const registrarInativa = deps.registrarInativa ?? registrarLeituraSensorInativo;

  for (const leitura of resultado.inexistentes) {
    await deps.publicarLeituraNaDlq({
      evento,
      leitura,
      motivo: MOTIVO_SENSOR_INEXISTENTE,
    });
  }

  // Por último: se a publicação falhar, o evento é reprocessado e as inativas
  // seriam contadas duas vezes se o registro viesse antes.
  for (const { leitura } of resultado.inativas) {
    registrarInativa({
      estacaoId: evento.estacao_uuid,
      codigo: leitura.sensor,
      unixtime: evento.unixtime,
      valorBruto: leitura.valor,
    });
  }
}
