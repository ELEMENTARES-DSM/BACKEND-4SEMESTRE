import { carregarConfigMqtt } from "../../config/mqtt.config";

// Unitário de carregarConfigMqtt: o ambiente é passado como argumento.
describe("carregarConfigMqtt", () => {
  const envValido = {
    MQTT_BROKER_URL: "mqtt://mosquitto:1883",
    MQTT_QOS: "1",
  };

  it("deve aceitar a configuração quando usuário e senha estão ausentes", () => {
    // Dado (Arrange)
    // Quando (Act)
    const config = carregarConfigMqtt(envValido);

    // Então (Assert)
    expect(config).toEqual({ brokerUrl: "mqtt://mosquitto:1883", qos: 1 });
    expect(config.usuario).toBeUndefined();
    expect(config.senha).toBeUndefined();
  });

  it("deve tratar usuário e senha vazios como ausentes quando o .env deixa as variáveis em branco", () => {
    // Dado (Arrange)
    const env = { ...envValido, MQTT_USER: "", MQTT_PASSWORD: "" };

    // Quando (Act)
    const config = carregarConfigMqtt(env);

    // Então (Assert)
    expect(config.usuario).toBeUndefined();
    expect(config.senha).toBeUndefined();
  });

  it("deve aceitar a configuração com só o usuário quando a senha está ausente", () => {
    // Dado (Arrange)
    const env = { ...envValido, MQTT_USER: "ingestao-dados" };

    // Quando (Act)
    const config = carregarConfigMqtt(env);

    // Então (Assert)
    expect(config.usuario).toBe("ingestao-dados");
    expect(config.senha).toBeUndefined();
  });

  it("deve aceitar a configuração com só a senha quando o usuário está ausente", () => {
    // Dado (Arrange)
    const env = { ...envValido, MQTT_PASSWORD: "segredo" };

    // Quando (Act)
    const config = carregarConfigMqtt(env);

    // Então (Assert)
    expect(config.usuario).toBeUndefined();
    expect(config.senha).toBe("segredo");
  });

  it("deve devolver usuário e senha quando as variáveis estão preenchidas", () => {
    // Dado (Arrange)
    const env = { ...envValido, MQTT_USER: "ingestao-dados", MQTT_PASSWORD: "segredo" };

    // Quando (Act)
    const config = carregarConfigMqtt(env);

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

  it("deve lançar erro quando MQTT_BROKER_URL está ausente", () => {
    // Dado (Arrange)
    const env = { ...envValido, MQTT_BROKER_URL: "" };

    // Quando (Act)
    const carregar = () => carregarConfigMqtt(env);

    // Então (Assert)
    expect(carregar).toThrow("MQTT_BROKER_URL é obrigatório");
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
