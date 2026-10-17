export interface ConfigMqtt {
  brokerUrl: string;
  usuario: string;
  senha: string;
  qos: 1 | 2;
}

export function carregarConfigMqtt(env: NodeJS.ProcessEnv = process.env): ConfigMqtt {
  const brokerUrl = env.MQTT_BROKER_URL;
  const usuario = env.MQTT_USER;
  const senha = env.MQTT_PASSWORD;
  const qos = Number(env.MQTT_QOS ?? "1");

  if (!brokerUrl || !usuario || !senha) {
    throw new Error("MQTT_BROKER_URL, MQTT_USER e MQTT_PASSWORD são obrigatórios");
  }

  if (qos !== 1 && qos !== 2) {
    throw new Error(`MQTT_QOS inválido: ${env.MQTT_QOS}. Use 1 ou 2`);
  }

  return { brokerUrl, usuario, senha, qos };
}
