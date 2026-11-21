/** Mensagem como chegou do broker, antes de qualquer verificação (US-40). */
export interface MensagemBruta {
  topico: string;
  payloadBruto: string;
  recebidoEm: string;
}

export interface MensagemIngestaoInput extends MensagemBruta {
  /** MAC da estação, extraído do tópico (12 hex minúsculos). */
  macAddress: string;
}

export interface LeituraItem {
  sensor: string;
  valor: number;
}

export interface PayloadLeituraValidado {
  timestamp: string;
  nivel_bateria?: number;
  leituras: LeituraItem[];
}
