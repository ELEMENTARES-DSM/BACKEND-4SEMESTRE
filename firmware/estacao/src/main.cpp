// Só liga os módulos de lib/: a cada ciclo lê o sensor de PM2.5 e publica a telemetria
// (MQTT sobre TLS, QoS 1, confirmada pelo PUBACK).
#include <Arduino.h>
#include <time.h>

#include "config.h"
#include "conexao.h"
#include "relogio.h"
#include "sensor_pm.h"
#include "telemetria.h"

namespace {

conexao::ClienteMqtt mqtt;
sensores::SensorPm sensorPm;
char topico[96];

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

void executarCiclo() {
  sensores::LeituraPm pm;
  if (!sensorPm.ler(&pm, 5000)) {
    Serial.println("[ciclo] sensor de PM sem resposta (fiacao/pinos?), leitura descartada");
    return;
  }

  const telemetria::Leitura leituras[] = {
      {CODIGO_PM25, static_cast<float>(pm.pm25)},
  };
  char payload[256];
  const size_t tamanho = telemetria::montar(time(nullptr), telemetria::kSemBateria, leituras,
                                            sizeof(leituras) / sizeof(leituras[0]), payload,
                                            sizeof(payload));
  if (tamanho == 0) {
    Serial.println("[ciclo] payload nao montado (relogio invalido?), leitura descartada");
    return;
  }

  // TODO(fila): guardar na fila em anel quando estiver sem conexão, em vez de descartar.
  if (!mqtt.conectado()) {
    Serial.println("[ciclo] sem conexao MQTT, leitura descartada");
    return;
  }

  Serial.printf("[ciclo] PM1.0=%u PM2.5=%u PM10=%u ug/m3\n", pm.pm1, pm.pm25, pm.pm10);
  Serial.printf("[ciclo] payload: %s\n", payload);

  const uint32_t inicio = millis();
  const int msgId = mqtt.publicarQoS1(topico, payload);
  if (msgId <= 0) {
    Serial.println("[ciclo] publicacao recusada pelo cliente MQTT");
    return;
  }
  if (mqtt.aguardarPuback(msgId, 10000)) {
    Serial.printf("[ciclo] PUBACK recebido (msg_id=%d) em %lu ms\n", msgId,
                  static_cast<unsigned long>(millis() - inicio));
  } else {
    Serial.println("[ciclo] PUBACK NAO recebido em 10 s");
  }
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n[estacao] iniciando");

  // O sensor precisa de 30 s de aquecimento: ligar já aqui faz isso rodar junto com Wi-Fi e TLS.
  sensorPm.iniciar(Serial2, PM_PINO_RX, PM_PINO_TX);

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

  anotarHeap("antes do TLS");
  if (!mqtt.iniciar(cfg)) falhar("cliente MQTT nao iniciou");
  if (!mqtt.aguardarConexao(20000)) falhar("MQTT/TLS nao conectou (veja o erro acima)");
  anotarHeap("depois do TLS");

  snprintf(topico, sizeof(topico), "pulso/estacoes/%s/telemetria", ESTACAO_UUID);

  executarCiclo();  // primeira leitura logo depois de subir; as próximas seguem o relógio
}

void loop() {
  const uint32_t espera = relogio::segundosAteProximoCiclo(time(nullptr), INTERVALO_LEITURA_S);
  Serial.printf("[ciclo] proxima leitura em %lu s\n", static_cast<unsigned long>(espera));
  delay(espera * 1000UL);
  executarCiclo();
}
