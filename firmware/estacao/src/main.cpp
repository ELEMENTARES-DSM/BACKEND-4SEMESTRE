// Só liga os módulos de lib/. Por enquanto roda o teste de conexão (26.01):
// conecta no broker (TLS, porta 8883), publica 1 mensagem em QoS 1, confere o PUBACK
// e anota a memória livre antes e depois do TLS.
#include <Arduino.h>
#include <ArduinoJson.h>
#include <time.h>

#include "config.h"
#include "conexao.h"

namespace {

conexao::ClienteMqtt mqtt;

void anotarHeap(const char* rotulo) {
  Serial.printf("[heap] %-14s livre=%lu minimo_desde_boot=%lu maior_bloco=%lu\n", rotulo,
                static_cast<unsigned long>(ESP.getFreeHeap()),
                static_cast<unsigned long>(ESP.getMinFreeHeap()),
                static_cast<unsigned long>(ESP.getMaxAllocHeap()));
}

void falhar(const char* motivo) {
  Serial.printf("[erro] %s. Reiniciando em 30 s.\n", motivo);
  delay(30000);
  ESP.restart();
  while (true) delay(1000);
}

// TODO(26.04): trocar pelo módulo telemetria e pelo contrato da US-12.
// Os nomes dos campos abaixo são provisórios.
size_t montarPayloadTeste(char* saida, size_t tamanho) {
  JsonDocument doc;
  doc["timestamp"] = static_cast<uint32_t>(time(nullptr));
  doc["nivel_bateria"] = 100;
  JsonArray leituras = doc["leituras"].to<JsonArray>();
  JsonObject temperatura = leituras.add<JsonObject>();
  temperatura["sensor"] = CODIGO_TEMPERATURA;
  temperatura["valor"] = 25.0;
  JsonObject umidade = leituras.add<JsonObject>();
  umidade["sensor"] = CODIGO_UMIDADE;
  umidade["valor"] = 60.0;
  return serializeJson(doc, saida, tamanho);
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n[estacao] teste de conexao MQTT/TLS");

  const uint32_t heapBoot = ESP.getFreeHeap();
  anotarHeap("boot");

  if (!conexao::conectarWifi(WIFI_SSID, WIFI_SENHA, 20000)) falhar("Wi-Fi nao conectou");
  if (!conexao::sincronizarHorario(NTP_SERVIDOR, 15000)) falhar("NTP nao sincronizou");
  Serial.printf("[ntp] hora UTC: %lu\n", static_cast<unsigned long>(time(nullptr)));

  conexao::ConfigMqtt cfg = {};
  cfg.host = MQTT_HOST;
  cfg.porta = MQTT_PORTA;
  cfg.clientId = ESTACAO_UUID;
  cfg.usuario = MQTT_USUARIO;
  cfg.senha = MQTT_SENHA;
  cfg.caCert = CA_CERT;
  cfg.clientCert = CLIENT_CERT;
  cfg.clientKey = CLIENT_KEY;
  cfg.keepaliveS = 60;
  cfg.verificarNome = true;
#ifdef MQTT_PULAR_VERIFICACAO_NOME
  cfg.verificarNome = false;
#endif

  // Wi-Fi e NTP já estão de pé: a diferença abaixo é só do TLS + MQTT.
  const uint32_t heapAntes = ESP.getFreeHeap();
  anotarHeap("antes do TLS");

  if (!mqtt.iniciar(cfg)) falhar("cliente MQTT nao iniciou");
  if (!mqtt.aguardarConexao(20000)) falhar("MQTT/TLS nao conectou (veja o erro acima)");

  const uint32_t heapDepois = ESP.getFreeHeap();
  anotarHeap("depois do TLS");

  char topico[96];
  snprintf(topico, sizeof(topico), "pulso/estacoes/%s/telemetria", ESTACAO_UUID);
  char payload[256];
  montarPayloadTeste(payload, sizeof(payload));

  const uint32_t inicio = millis();
  const int msgId = mqtt.publicarQoS1(topico, payload);
  if (msgId <= 0) falhar("publicacao recusada pelo cliente");
  const bool puback = mqtt.aguardarPuback(msgId, 10000);
  const uint32_t ms = millis() - inicio;

  Serial.println("\n===== RESULTADO =====");
  Serial.printf("topico              : %s\n", topico);
  Serial.printf("heap no boot        : %lu\n", static_cast<unsigned long>(heapBoot));
  Serial.printf("heap antes do TLS   : %lu\n", static_cast<unsigned long>(heapAntes));
  Serial.printf("heap depois do TLS  : %lu\n", static_cast<unsigned long>(heapDepois));
  Serial.printf("TLS + MQTT retem    : %ld bytes\n", static_cast<long>(heapAntes) - static_cast<long>(heapDepois));
  Serial.printf("minimo desde o boot : %lu (inclui o pico do handshake)\n",
                static_cast<unsigned long>(ESP.getMinFreeHeap()));
  if (puback) {
    Serial.printf("PUBACK              : recebido (msg_id=%d) em %lu ms\n", msgId, static_cast<unsigned long>(ms));
  } else {
    Serial.println("PUBACK              : NAO recebido em 10 s");
  }
  Serial.println("=====================");
}

void loop() {
  delay(1000);
}
