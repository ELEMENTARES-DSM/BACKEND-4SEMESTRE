#pragma once
// Wi-Fi, NTP e MQTT sobre TLS (cliente esp-mqtt do core Arduino da ESP32).
// Só compila no esp32. Não inclui config.h: os valores chegam por parâmetro do main.cpp.
#include <Arduino.h>
#include <WiFi.h>
#include <stdint.h>

#include <atomic>

#include "mqtt_client.h"

namespace conexao {

// Conecta na rede Wi-Fi. Retorna false se não conectar dentro do prazo.
bool conectarWifi(const char* ssid, const char* senha, uint32_t timeoutMs);

// Ajusta o relógio por NTP (UTC). O TLS confere a validade do certificado,
// então isto precisa acontecer antes de conectar no MQTT.
bool sincronizarHorario(const char* servidor, uint32_t timeoutMs);

struct ConfigMqtt {
  const char* host;
  uint16_t porta;
  const char* clientId;
  const char* usuario;
  const char* senha;
  const char* caCert;      // CA que assinou o certificado do broker (PEM)
  const char* clientCert;  // certificado desta estação (PEM)
  const char* clientKey;   // chave privada desta estação (PEM)
  uint16_t keepaliveS;
  bool verificarNome;      // false só para depuração (ver config.example.h)
};

class ClienteMqtt {
 public:
  ClienteMqtt() = default;
  ~ClienteMqtt();
  ClienteMqtt(const ClienteMqtt&) = delete;
  ClienteMqtt& operator=(const ClienteMqtt&) = delete;

  // Inicia o cliente; o handshake TLS e o CONNECT acontecem em segundo plano.
  bool iniciar(const ConfigMqtt& cfg);

  // Espera o CONNACK. Retorna false no primeiro erro (TLS, usuário/senha) ou no prazo.
  bool aguardarConexao(uint32_t timeoutMs);

  // Publica em QoS 1. Retorna o msg_id (> 0) ou -1 em erro.
  int publicarQoS1(const char* topico, const char* payload);

  // Espera o PUBACK do broker para esse msg_id.
  bool aguardarPuback(int msgId, uint32_t timeoutMs);

  bool conectado() const { return conectado_; }

 private:
  static void aoEvento(void* args, esp_event_base_t base, int32_t id, void* dados);

  esp_mqtt_client_handle_t cliente_ = nullptr;
  char uri_[96] = {0};
  std::atomic<bool> conectado_{false};
  std::atomic<bool> erro_{false};
  std::atomic<int> ultimoPuback_{0};
};

}  // namespace conexao
