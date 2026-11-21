export const TOPICO_ASSINATURA = "pulso/estacoes/+/telemetria";

// O tópico identifica a estação pelo MAC físico (12 hex, sem separador).
const TOPICO_TELEMETRIA = /^pulso\/estacoes\/([0-9a-f]{12})\/telemetria$/i;

// Devolve o MAC da estação em minúsculas se o tópico segue pulso/estacoes/<mac>/telemetria.
// O firmware pode publicar em maiúsculas; a comparação com o cadastro é sempre em minúsculas.
export function extrairMacDoTopico(topico: string): string | null {
  const resultado = TOPICO_TELEMETRIA.exec(topico);
  return resultado ? resultado[1].toLowerCase() : null;
}
