// Aceita o MAC com ou sem separador (":" ou "-"), em maiúsculas ou minúsculas.
const MAC_SEM_SEPARADOR = /^[0-9a-fA-F]{12}$/;
// Um único separador em todo o MAC (o \2 repete o primeiro).
const MAC_COM_SEPARADOR = /^[0-9a-fA-F]{2}([:-])(?:[0-9a-fA-F]{2}\1){4}[0-9a-fA-F]{2}$/;

/**
 * Devolve o MAC no formato guardado no banco e usado no tópico MQTT
 * (12 hex minúsculos, sem separador), ou null se o valor não for um MAC.
 */
export const normalizarMac = (valor: string): string | null => {
  const limpo = valor.trim();
  if (!MAC_SEM_SEPARADOR.test(limpo) && !MAC_COM_SEPARADOR.test(limpo)) {
    return null;
  }
  return limpo.replace(/[:-]/g, "").toLowerCase();
};
