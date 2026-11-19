import { carregarConfigMqtt } from "../../config/mqtt.config";

// Unitário de carregarConfigMqtt: o ambiente é passado como argumento.
describe("carregarConfigMqtt", () => {
  const envValido = {
    MQTT_BROKER_URL: "mqtt://mosquitto:1883",
    MQTT_USER: "ingestao-dados",
    MQTT_PASSWORD: "segredo",
    MQTT_QOS: "1",
  };

  it("deve devolver URL, usuário, senha e QoS quando as variáveis estão preenchidas", () => {
    // Dado (Arrange)
    // Quando (Act)
    const config = carregarConfigMqtt(envValido);

    // Então (Assert)
    expect(config).toEqual({ brokerUrl: "mqtt://mosquitto:1883", usuario: "ingestao-dados", senha: "segredo", qos: 1 });
  });

  it("deve usar QoS 1 quando MQTT_QOS não é informado", () => {
    // Dado (Arrange)
    const env = { ...envValido, MQTT_QOS: undefined };

    // Quando (Act)
    const config = carregarConfigMqtt(env);

    // Então (Assert)
    expect(config.qos).toBe(1);
  });

  it("deve lançar erro quando a senha está ausente", () => {
    // Dado (Arrange)
    const env = { ...envValido, MQTT_PASSWORD: "" };

    // Quando (Act)
    const carregar = () => carregarConfigMqtt(env);

    // Então (Assert)
    expect(carregar).toThrow("MQTT_BROKER_URL, MQTT_USER e MQTT_PASSWORD são obrigatórios");
  });

  it("deve lançar erro quando o QoS está fora de 1 e 2", () => {
    // Dado (Arrange)
    const env = { ...envValido, MQTT_QOS: "0" };

    // Quando (Act)
    const carregar = () => carregarConfigMqtt(env);

    // Então (Assert)
    expect(carregar).toThrow("MQTT_QOS inválido");
  });
});
