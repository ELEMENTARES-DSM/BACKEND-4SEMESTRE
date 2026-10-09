// O formato completo do tópico ainda deve ser confirmado com o produtor MQTT.
export function extrairUuidEstacaoDoTopico(topico: string): string | null {
  const partes = topico.split(".");
  if (partes.length !== 2 || partes[0] !== "leituras") return null;
  const uuid = partes[1];
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid)
    ? uuid.toLowerCase() : null;
}
