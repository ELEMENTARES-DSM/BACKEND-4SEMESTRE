
import mqtt, { type MqttClient } from "mqtt";

export function criarClienteMqtt(): MqttClient {
  const brokerUrl =
    process.env.MQTT_BROKER_URL ?? "mqtt://mosquitto:1883";

  const username = process.env.MQTT_USER;
  const password = process.env.MQTT_PASSWORD;

  const client = mqtt.connect(brokerUrl, {
    username,
    password,
    reconnectPeriod: 3000,
    connectTimeout: 10000,
    clean: true,
  });

  client.on("connect", () => {
    console.log(`[mqtt] Conectado ao broker ${brokerUrl}`);
  });

  client.on("reconnect", () => {
    console.log("[mqtt] Tentando reconectar...");
  });

  client.on("offline", () => {
    console.warn("[mqtt] Broker indisponível; aguardando reconexão.");
  });

  client.on("error", (error) => {
    console.error("[mqtt] Erro:", error.message);
  });

  return client;
}

export function publicar(
  client: MqttClient,
  estacaoId: string,
  payload: unknown,
): Promise<void> {
  const topico = `pulso/estacoes/${estacaoId}/telemetria`;
  const mensagem = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    client.publish(
      topico,
      mensagem,
      { qos: 1, retain: false },
      (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      },
    );
  });
}
