// Só liga os módulos de lib/; sem lógica de negócio aqui.
#include <Arduino.h>
#include "config.h"

void setup() {
  Serial.begin(115200);
}

void loop() {
  delay(1000);
}
