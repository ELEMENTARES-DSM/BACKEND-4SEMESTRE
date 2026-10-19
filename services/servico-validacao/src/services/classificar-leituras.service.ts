import { EventoTelemetria } from "../dto/evento-telemetria.dto";
import { SensorDaEstacao } from "../models/sensor.model";
import { buscarSensorDaEstacao } from "../repositories/sensor.repository";

export type LeituraEvento = EventoTelemetria["leituras"][number];

export interface LeituraComSensor {
  leitura: LeituraEvento;
  sensor: SensorDaEstacao;
}

export interface LeiturasClassificadas {
  validas: LeituraComSensor[];
  inativas: LeituraComSensor[];
  inexistentes: LeituraEvento[];
}

export type BuscarSensor = (
  estacaoId: string,
  codigo: string,
) => Promise<SensorDaEstacao | null>;

export interface ClassificarLeiturasDeps {
  buscarSensor?: BuscarSensor;
}

/**
 * Classifica cada leitura do evento pelo sensor da estação, mantendo a ordem.
 * Sem cache: o status é lido a cada evento, para um sensor reativado voltar a
 * gerar medidas.
 */
export async function classificarLeituras(
  evento: EventoTelemetria,
  deps: ClassificarLeiturasDeps = {},
): Promise<LeiturasClassificadas> {
  const buscarSensor = deps.buscarSensor ?? buscarSensorDaEstacao;
  const classificadas: LeiturasClassificadas = {
    validas: [],
    inativas: [],
    inexistentes: [],
  };

  for (const leitura of evento.leituras) {
    const sensor = await buscarSensor(evento.estacao_uuid, leitura.sensor);

    if (sensor === null) {
      classificadas.inexistentes.push(leitura);
    } else if (sensor.status === "Ativo") {
      classificadas.validas.push({ leitura, sensor });
    } else {
      classificadas.inativas.push({ leitura, sensor });
    }
  }

  return classificadas;
}
