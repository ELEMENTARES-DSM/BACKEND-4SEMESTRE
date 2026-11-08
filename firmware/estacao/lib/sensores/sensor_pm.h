#pragma once
// Driver do sensor de partículas PMS5003/PMS7003 (Plantower) por UART. Só compila no esp32.
#include <Arduino.h>
#include <stdint.h>

namespace sensores {

struct LeituraPm {
  uint16_t pm1;   // µg/m³
  uint16_t pm25;  // µg/m³
  uint16_t pm10;  // µg/m³
};

class SensorPm {
 public:
  // pinoRx = pino da ESP32 ligado ao TX do sensor; pinoTx = pino ligado ao RX do sensor.
  // O sensor precisa estar no modo ativo (padrão de fábrica: envia um quadro por segundo).
  void iniciar(HardwareSerial& serial, int8_t pinoRx, int8_t pinoTx);

  // Devolve o quadro mais recente. Nos primeiros 30 s depois de iniciar() espera o
  // aquecimento (o fabricante informa leitura instável antes disso). Retorna false se
  // nenhum quadro válido chegar dentro de timeoutMs.
  bool ler(LeituraPm* saida, uint32_t timeoutMs);

 private:
  bool alimentar(uint8_t byte, LeituraPm* saida);

  HardwareSerial* serial_ = nullptr;
  uint32_t inicioMs_ = 0;
  uint8_t quadro_[32] = {0};
  uint8_t indice_ = 0;
};

}  // namespace sensores
