#include "conexao.h"

#include <string.h>
#include <time.h>

#include "esp_idf_version.h"

namespace conexao {

namespace {

// Data anterior a esta (ex.: 1970, antes do NTP) significa relógio não ajustado.
// TODO(26.03): mover para o módulo relogio (lógica pura, com testes).
const time_t kEpochMinimoValido = 1700000000;

// Bits de mbedtls_ssl_get_verify_result() mais comuns em falha de certificado.
void dicaCertificado(int flags) {
  if (flags & 0x01) Serial.println("  - certificado expirado (confira o relógio)");
  if (flags & 0x04) Serial.println("  - nome/IP do broker não bate com o certificado");
  if (flags & 0x08) Serial.println("  - CA não reconhecida (CA_CERT diferente da que assinou o broker)");
  if (flags & 0x200) Serial.println("  - certificado ainda não válido (relógio atrasado)");
}

void registrarErro(const esp_mqtt_event_t* ev) {
  const esp_mqtt_error_codes_t* e = ev->error_handle;
  if (e == nullptr) {
    Serial.println("[mqtt] erro sem detalhes");
    return;
  }
  switch (e->error_type) {
    case MQTT_ERROR_TYPE_TCP_TRANSPORT:
      Serial.printf("[mqtt] falha de transporte/TLS: esp_err=0x%x mbedtls=-0x%04x cert_flags=0x%x errno=%d\n",
                    static_cast<unsigned>(e->esp_tls_last_esp_err),
                    static_cast<unsigned>(-e->esp_tls_stack_err),
                    static_cast<unsigned>(e->esp_tls_cert_verify_flags),
                    static_cast<int>(e->esp_transport_sock_errno));
      dicaCertificado(e->esp_tls_cert_verify_flags);
      break;
    case MQTT_ERROR_TYPE_CONNECTION_REFUSED:
      Serial.printf("[mqtt] broker recusou a conexão (codigo %d): confira usuário, senha e ACL\n",
                    static_cast<int>(e->connect_return_code));
      break;
    default:
      Serial.printf("[mqtt] erro tipo %d\n", static_cast<int>(e->error_type));
      break;
  }
}

}  // namespace

bool conectarWifi(const char* ssid, const char* senha, uint32_t timeoutMs) {
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, senha);
  const uint32_t inicio = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - inicio > timeoutMs) return false;
    delay(250);
  }
  Serial.printf("[wifi] conectado, IP %s\n", WiFi.localIP().toString().c_str());
  return true;
}

bool sincronizarHorario(const char* servidor, uint32_t timeoutMs) {
  configTime(0, 0, servidor);
  const uint32_t inicio = millis();
  while (time(nullptr) < kEpochMinimoValido) {
    if (millis() - inicio > timeoutMs) return false;
    delay(200);
  }
  return true;
}

ClienteMqtt::~ClienteMqtt() {
  if (cliente_ != nullptr) {
    esp_mqtt_client_stop(cliente_);
    esp_mqtt_client_destroy(cliente_);
  }
}

bool ClienteMqtt::iniciar(const ConfigMqtt& cfg) {
  snprintf(uri_, sizeof(uri_), "mqtts://%s:%u", cfg.host, static_cast<unsigned>(cfg.porta));

  esp_mqtt_client_config_t mc = {};
#if ESP_IDF_VERSION_MAJOR >= 5
  mc.broker.address.uri = uri_;
  mc.broker.verification.certificate = cfg.caCert;
  mc.broker.verification.skip_cert_common_name_check = !cfg.verificarNome;
  mc.credentials.client_id = cfg.clientId;
  mc.credentials.username = cfg.usuario;
  mc.credentials.authentication.password = cfg.senha;
  mc.credentials.authentication.certificate = cfg.clientCert;
  mc.credentials.authentication.key = cfg.clientKey;
  mc.session.keepalive = cfg.keepaliveS;
#else
  mc.uri = uri_;
  mc.cert_pem = cfg.caCert;
  mc.skip_cert_common_name_check = !cfg.verificarNome;
  mc.client_id = cfg.clientId;
  mc.username = cfg.usuario;
  mc.password = cfg.senha;
  mc.client_cert_pem = cfg.clientCert;
  mc.client_key_pem = cfg.clientKey;
  mc.keepalive = cfg.keepaliveS;
#endif

  cliente_ = esp_mqtt_client_init(&mc);
  if (cliente_ == nullptr) return false;
  if (esp_mqtt_client_register_event(cliente_, MQTT_EVENT_ANY, &ClienteMqtt::aoEvento, this) != ESP_OK) {
    return false;
  }
  return esp_mqtt_client_start(cliente_) == ESP_OK;
}

bool ClienteMqtt::aguardarConexao(uint32_t timeoutMs) {
  const uint32_t inicio = millis();
  while (!conectado_) {
    if (erro_ || millis() - inicio > timeoutMs) return false;
    delay(50);
  }
  return true;
}

int ClienteMqtt::publicarQoS1(const char* topico, const char* payload) {
  if (cliente_ == nullptr) return -1;
  return esp_mqtt_client_publish(cliente_, topico, payload, static_cast<int>(strlen(payload)), 1, 0);
}

bool ClienteMqtt::aguardarPuback(int msgId, uint32_t timeoutMs) {
  if (msgId <= 0) return false;
  const uint32_t inicio = millis();
  while (ultimoPuback_ != msgId) {
    if (millis() - inicio > timeoutMs) return false;
    delay(5);
  }
  return true;
}

// Roda na task do esp-mqtt: só atualiza flags (e loga erro), nada pesado aqui.
void ClienteMqtt::aoEvento(void* args, esp_event_base_t, int32_t id, void* dados) {
  ClienteMqtt* self = static_cast<ClienteMqtt*>(args);
  esp_mqtt_event_handle_t ev = static_cast<esp_mqtt_event_handle_t>(dados);

  switch (id) {
    case MQTT_EVENT_CONNECTED:
      self->erro_ = false;
      self->conectado_ = true;
      break;
    case MQTT_EVENT_DISCONNECTED:
      self->conectado_ = false;
      break;
    case MQTT_EVENT_PUBLISHED:  // PUBACK do broker (só dispara para QoS 1 e 2)
      self->ultimoPuback_ = ev->msg_id;
      break;
    case MQTT_EVENT_ERROR:
      self->erro_ = true;
      registrarErro(ev);
      break;
    default:
      break;
  }
}

}  // namespace conexao
