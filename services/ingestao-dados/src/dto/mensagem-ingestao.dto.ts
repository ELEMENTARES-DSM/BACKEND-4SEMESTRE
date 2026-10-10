export interface MensagemIngestaoInput {
  estacaoId: string;
  topico: string;
  payloadBruto: string;
  recebidoEm: string;
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
