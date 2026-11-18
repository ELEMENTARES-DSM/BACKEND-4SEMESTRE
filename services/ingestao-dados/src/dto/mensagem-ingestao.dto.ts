/** Mensagem como chegou do broker, antes de qualquer verificação (US-40). */
export interface MensagemBruta {
  topico: string;
  payloadBruto: string;
  recebidoEm: string;
}

export interface MensagemIngestaoInput extends MensagemBruta {
  estacaoId: string;
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
