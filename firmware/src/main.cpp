#include <WiFi.h>
#include <PubSubClient.h>
#include <time.h>

char* ssid = "";
char* pwd = "";

String uid;

time_t now;

char* mqtt_server = "test.mosquitto.org";

WiFiClient wClient;
PubSubClient mqttClient(wClient);

float t = 20.0;
float u = 50.0;

unsigned long previousMillis = 0;
const unsigned long interval = 10000;

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
    if (mqttClient.connect("2023Diogo")) {
      Serial.println("Conectou no MQTT");
      mqttClient.subscribe("fatec/labs/407/luz/");
    } else {
      Serial.print("Falha MQTT: ");
      Serial.println(mqttClient.state());
    }
  }
}

void setup() {
  Serial.begin(115200);
  WiFi.begin(ssid, pwd);

  connectWiFi();

  uid = WiFi.macAddress();
  uid.replace(":", "");

  mqttClient.setServer(mqtt_server, 1883);
  mqttClient.setCallback(mqtt_callback);

  connectMqtt();
  configTime(0, 0, "pool.ntp.org");
}

void loop() {

  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  if (!mqttClient.connected()) {
    connectMqtt();
  }

  mqttClient.loop();

  unsigned long currentMillis = millis();

  if (currentMillis - previousMillis >= interval) {
    previousMillis = currentMillis;

    if (mqttClient.connected()) {
      time(&now);

      String data = "{\"uid\":\"" + uid +
                    "\",\"unx\":" + String((long)now) +
                    ",\"temp\":" + String(t, 2) +
                    ",\"umi\":" + String(u, 2) + "}";

      Serial.println("Publicando:");
      Serial.println(data);

      bool enviado = mqttClient.publish(
        "fatec/labs/407/data/",
        data.c_str()
      );

      if (enviado) {
        Serial.println("Mensagem publicada!");
      } else {
        Serial.println("Erro ao publicar!");
      }

      t += 0.6;
      u += 0.8;
    }
  }

  delay(10);
}
