import { validarEstacaoPorId } from "./validacao-estacao.service";

export interface MensagemRecebida {
  estacaoId: string;
  payloadBruto: string;
  recebidoEm: string | Date;
}

// Usar após as demais validações da US-12. A entrega concreta é da US-13.
export async function processarLeitura<T extends MensagemRecebida>(
  mensagem: T,
  entregarParaUS13: (mensagem: T) => Promise<void>,
  opcoes: Parameters<typeof validarEstacaoPorId>[1] = {},
) {
  const resultado = await validarEstacaoPorId(mensagem.estacaoId, opcoes);
  if (resultado.valido) await entregarParaUS13(mensagem);
  return resultado;
}
