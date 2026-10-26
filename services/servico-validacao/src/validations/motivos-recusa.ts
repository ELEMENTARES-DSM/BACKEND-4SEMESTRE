// Motivos fixos gravados no corpo dos eventos enviados à validacao.dlq (US-18).
export const SENSOR_INEXISTENTE = "Sensor inexistente na estação";
export const EVENTO_MALFORMADO = "Evento malformado";

export const MOTIVOS_RECUSA = [SENSOR_INEXISTENTE, EVENTO_MALFORMADO] as const;

export type MotivoRecusa = (typeof MOTIVOS_RECUSA)[number];
