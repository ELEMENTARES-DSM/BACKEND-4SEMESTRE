export interface ConfigMqtt {
  brokerUrl: string;
  // Opcionais: desde a US-29 o broker aceita conexão sem credencial.
  usuario?: string;
  senha?: string;
  qos: 1 | 2;
}

export function carregarConfigMqtt(env: NodeJS.ProcessEnv = process.env): ConfigMqtt {
  const brokerUrl = env.MQTT_BROKER_URL;
  const usuario = env.MQTT_USER || undefined;
  const senha = env.MQTT_PASSWORD || undefined;
  const qos = Number(env.MQTT_QOS ?? "1");

  if (!brokerUrl) {
    throw new Error("MQTT_BROKER_URL é obrigatório");
  }

  if (qos !== 1 && qos !== 2) {
    throw new Error(`MQTT_QOS inválido: ${env.MQTT_QOS}. Use 1 ou 2`);
  }

  return { brokerUrl, usuario, senha, qos };
}
