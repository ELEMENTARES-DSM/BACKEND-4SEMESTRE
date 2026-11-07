#pragma once
// Copie para config.h (fora do Git) e preencha com os dados da estação.
#define ESTACAO_UUID        "00000000-0000-0000-0000-000000000000"
#define WIFI_SSID           "nome-da-rede"
#define WIFI_SENHA          "senha-da-rede"
#define MQTT_HOST           "192.168.0.250"   // IP fixo do servidor (US-29)
#define MQTT_PORTA          8883
#define MQTT_USUARIO        "usuario-da-estacao"
#define MQTT_SENHA          "senha-mostrada-pelo-acesso-estacao"
#define NTP_SERVIDOR        "pool.ntp.org"    // ou o servidor local sem internet
#define INTERVALO_LEITURA_S 300
// Sensor físico → código cadastrado na plataforma
#define CODIGO_TEMPERATURA  "TEMP-01"
#define CODIGO_UMIDADE      "UMID-01"
static const char CA_CERT[]     = R"(-----BEGIN CERTIFICATE-----
...
-----END CERTIFICATE-----)";
static const char CLIENT_CERT[] = R"(...)";
static const char CLIENT_KEY[]  = R"(...)";
