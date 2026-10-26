export const PAYLOAD_MALFORMADO = "Payload malformado";
export const TIMESTAMP_INVALIDO = "Timestamp ausente ou inválido";
export const LISTA_LEITURAS_VAZIA = "Lista de leituras ausente ou vazia";
export const LEITURA_INCOMPLETA = "Leitura inválida: sensor ou valor ausente";
export const BATERIA_FORA_DA_FAIXA = "Nível de bateria fora de 0 a 100";
export const ESTACAO_DESCONHECIDA = "Estação desconhecida";
export const ESTACAO_INATIVA = "Estação inativa";

export const MOTIVOS_REJEICAO = [
  PAYLOAD_MALFORMADO,
  TIMESTAMP_INVALIDO,
  LISTA_LEITURAS_VAZIA,
  LEITURA_INCOMPLETA,
  BATERIA_FORA_DA_FAIXA,
  ESTACAO_DESCONHECIDA,
  ESTACAO_INATIVA,
] as const;

export const todosOsMotivos = MOTIVOS_REJEICAO;
export const motivosRejeicao = MOTIVOS_REJEICAO;

export type MotivoRejeicao = (typeof MOTIVOS_REJEICAO)[number];
