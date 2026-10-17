import { carregarConfigMqtt } from "../../config/mqtt.config";

describe("carregarConfigMqtt", () => {
  const envValido = {
    MQTT_BROKER_URL: "mqtt://mosquitto:1883",
    MQTT_USER: "ingestao-dados",
    MQTT_PASSWORD: "segredo",
    MQTT_QOS: "1",
  };

  test("lê as variáveis de ambiente", () => {
    expect(carregarConfigMqtt(envValido)).toEqual({
      brokerUrl: "mqtt://mosquitto:1883",
      usuario: "ingestao-dados",
      senha: "segredo",
      qos: 1,
    });
  });

  test("usa QoS 1 quando MQTT_QOS não é informado", () => {
    expect(carregarConfigMqtt({ ...envValido, MQTT_QOS: undefined }).qos).toBe(1);
  });

  test("falha quando credenciais estão ausentes", () => {
    expect(() => carregarConfigMqtt({ ...envValido, MQTT_PASSWORD: "" })).toThrow(
      "MQTT_BROKER_URL, MQTT_USER e MQTT_PASSWORD são obrigatórios",
    );
  });

  test("falha com QoS fora de 1 e 2", () => {
    expect(() => carregarConfigMqtt({ ...envValido, MQTT_QOS: "0" })).toThrow("MQTT_QOS inválido");
  });
});
