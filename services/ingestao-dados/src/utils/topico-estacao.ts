export const TOPICO_ASSINATURA = "pulso/estacoes/+/telemetria";

const TOPICO_TELEMETRIA =
  /^pulso\/estacoes\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/telemetria$/i;

// Devolve o UUID da estação se o tópico segue pulso/estacoes/<uuid>/telemetria.
export function extrairEstacaoId(topico: string): string | null {
  const resultado = TOPICO_TELEMETRIA.exec(topico);
  return resultado ? resultado[1] : null;
}
