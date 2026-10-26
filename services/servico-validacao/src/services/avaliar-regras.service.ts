import {
  AlarmeNormalizadoRow,
  AlarmeRow,
  MedidaParaAvaliar,
  OperadorRegra,
} from "../dto/alarme.dto";
import {
  inserirAlarmeAberto,
  normalizarAlarmeAberto,
  normalizarAlarmesDeRegrasInativas,
} from "../repositories/alarme.repository";
import { buscarRegrasAtivasPorSensores } from "../repositories/regra-alerta.repository";
import { DbQueryable } from "../repositories/sensor.repository";
import { paraBigIntEscala6 } from "./calibracao.service";

export interface ResultadoAvaliacaoRegras {
  abertos: AlarmeRow[];
  normalizados: AlarmeNormalizadoRow[];
}

/**
 * Compara o valor real com o limite em decimal exato: 50.00 não viola "> 50"
 * e viola ">= 50".
 */
export function violaRegra(valor: string, operador: OperadorRegra, limite: string): boolean {
  const v = paraBigIntEscala6(valor);
  const l = paraBigIntEscala6(limite);
  switch (operador) {
    case ">":
      return v > l;
    case ">=":
      return v >= l;
    case "<":
      return v < l;
    case "<=":
      return v <= l;
    case "=":
      return v === l;
  }
}

/**
 * US-22: compara cada medida nova e válida com as regras ativas do sensor, na
 * mesma transação em que a medida foi gravada. A medida que viola abre um alarme
 * por regra; a que não viola normaliza o alarme aberto da regra.
 */
export const avaliarRegrasDasMedidas = async (
  medidas: MedidaParaAvaliar[],
  agora: Date,
  db: DbQueryable,
): Promise<ResultadoAvaliacaoRegras> => {
  if (medidas.length === 0) {
    return { abertos: [], normalizados: [] };
  }

  const sensorIds = Array.from(new Set(medidas.map((m) => m.sensor_id)));
  const normalizados = await normalizarAlarmesDeRegrasInativas(sensorIds, agora, db);
  const regras = await buscarRegrasAtivasPorSensores(sensorIds, db);
  const abertos: AlarmeRow[] = [];

  for (const medida of medidas) {
    for (const regra of regras) {
      if (regra.sensor_id !== medida.sensor_id) {
        continue;
      }

      if (violaRegra(medida.valor, regra.operador, regra.valor_limite)) {
        const alarme = await inserirAlarmeAberto(
          {
            regra_id: regra.id,
            medida_id: medida.medida_id,
            sensor_id: medida.sensor_id,
            estacao_id: medida.estacao_id,
            municipio: medida.municipio,
            valor: medida.valor,
            operador: regra.operador,
            limite: regra.valor_limite,
            severidade: regra.severidade,
            lido_em: medida.lido_em,
            criado_em: agora,
          },
          db,
        );
        if (alarme) {
          abertos.push(alarme);
        }
        continue;
      }

      const normalizado = await normalizarAlarmeAberto(regra.id, medida.lido_em, agora, db);
      if (normalizado) {
        normalizados.push(normalizado);
      }
    }
  }

  return { abertos, normalizados };
};
