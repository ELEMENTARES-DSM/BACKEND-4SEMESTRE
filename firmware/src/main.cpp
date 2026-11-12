#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <time.h>

const char* ssid = "nome-wifi";
const char* pwd = "senha-wifi";
const char* mqtt_server = "test.mosquitto.org"; // alterar para broker local

String uid;
String topico;

time_t now;


WiFiClient wClient;
PubSubClient mqttClient(wClient);

// Sensor de partículas PMSX003
#define PM_PINO_RX 23  // pino da ESP32 ligado ao TX do sensor (ajuste de acordo com a placa)
#define PM_PINO_TX 19  // pino da ESP32 ligado ao RX do sensor (ajuste de acordo com a placa)

const unsigned long INICIO_MS = 30000;  // o sensor é instável nos primeiros 30 s
const unsigned long PM_VALIDADE_MS = 5000;   // quadro mais antigo que isso = sensor sem resposta

uint16_t pm25 = 0;  // µg/m³
uint16_t pm10 = 0;  // µg/m³
unsigned long ultimoQuadroMs = 0;
bool temQuadro = false;

uint8_t quadroPm[32];
uint8_t indicePm = 0;

unsigned long previousMillis = 0;
const unsigned long interval = 10000;

// Monta o quadro de 32 bytes byte a byte: 0x42 0x4D, tamanho, dados, soma de verificação.
// Concentração em "ambiente atmosférico": PM2.5 nos bytes 12-13 e PM10 nos bytes 14-15.
void processarByte(uint8_t b) {
  if (indicePm == 0 && b != 0x42) return;
  if (indicePm == 1 && b != 0x4D) {
    indicePm = (b == 0x42) ? 1 : 0;  // o 0x42 em quadroPm[0] continua valendo
    return;
  }

  quadroPm[indicePm++] = b;
  if (indicePm < 32) return;
  indicePm = 0;

  uint16_t soma = 0;
  for (uint8_t i = 0; i < 30; i++) soma += quadroPm[i];
  if (soma != (uint16_t)((quadroPm[30] << 8) | quadroPm[31])) return;  // quadro corrompido

  pm25 = (quadroPm[12] << 8) | quadroPm[13];
  pm10 = (quadroPm[14] << 8) | quadroPm[15];
  ultimoQuadroMs = millis();
  temQuadro = true;
}

// Chamada a cada volta do loop: o sensor envia um quadro por segundo e aqui só
// guardamos o mais recente.
void lerSensorPm() {
  while (Serial2.available() > 0) {
    processarByte((uint8_t)Serial2.read());
  }
}

void connectWiFi() {
  Serial.println("Conectando...");

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\nWiFi conectado!");
  Serial.println(WiFi.localIP());
}

void mqtt_callback(char* topic, byte* message, unsigned int length) {
  String msg;

  Serial.print(topic);
  Serial.print(" ");

  for (int i = 0; i < length; i++) {
    msg += (char)message[i];
  }

  Serial.println(msg);
}

void connectMqtt() {
  if (!mqttClient.connected()) {
    if (mqttClient.connect(uid.c_str())) {
      Serial.println("Conectou no MQTT");
      mqttClient.subscribe(topico.c_str());
    } else {
      Serial.print("Falha MQTT: ");
      Serial.println(mqttClient.state());
    }
  }
}

void setup() {
  Serial.begin(115200);

  // Liga o sensor primeiro: a iniciação roda junto com a conexão Wi-Fi.
  Serial2.begin(9600, SERIAL_8N1, PM_PINO_RX, PM_PINO_TX);

  WiFi.begin(ssid, pwd);

  connectWiFi();

  uid = WiFi.macAddress();
  uid.replace(":", "");
  topico = "pulso/estacoes/" + uid + "/telemetria";

  mqttClient.setServer(mqtt_server, 1883);
  mqttClient.setCallback(mqtt_callback);

  connectMqtt();
  configTime(0, 0, "br.pool.ntp.org");
}

void loop() {

  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  if (!mqttClient.connected()) {
    connectMqtt();
  }

  lerSensorPm();
  mqttClient.loop();

  unsigned long currentMillis = millis();

  if (currentMillis - previousMillis >= interval) {
    previousMillis = currentMillis;

    if (mqttClient.connected()) {
      time(&now);

      if (currentMillis < INICIO_MS) {
        Serial.println("Iniciando sensor...");
      } else if (!temQuadro || currentMillis - ultimoQuadroMs > PM_VALIDADE_MS) {
        Serial.println("Sem leitura recente do sensor (confira fiacao e pinos), nao publicou");
      } else if (now < 1700000000) {
        Serial.println("Aguardando horario do NTP, nao publicou");
      } else {
        String data = "{\"macaddress\":\"" + uid +
                      "\",\"unixtime\":" + String((long)now) +
                      ",\"pm25\":" + String(pm25) +
                      ",\"pm10\":" + String(pm10) + "}";

        Serial.println("Publicando:");
        Serial.println(data);

        bool enviado = mqttClient.publish(
          topico.c_str(),
          data.c_str()
        );

        if (enviado) {
          Serial.println("Mensagem publicada!");
        } else {
          Serial.println("Erro ao publicar!");
        }
      }
    }
  }

  delay(10);
}