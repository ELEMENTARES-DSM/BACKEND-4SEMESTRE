#include "sensor_pm.h"

namespace sensores {

namespace {

const uint32_t kBaud = 9600;
const uint32_t kAquecimentoMs = 30000;
const uint8_t kTamanhoQuadro = 32;
const uint8_t kCabecalho1 = 0x42;
const uint8_t kCabecalho2 = 0x4D;

}  // namespace

void SensorPm::iniciar(HardwareSerial& serial, int8_t pinoRx, int8_t pinoTx) {
  serial_ = &serial;
  serial_->begin(kBaud, SERIAL_8N1, pinoRx, pinoTx);
  inicioMs_ = millis();
  indice_ = 0;
}

bool SensorPm::ler(LeituraPm* saida, uint32_t timeoutMs) {
  if (serial_ == nullptr || saida == nullptr) return false;

  while (millis() - inicioMs_ < kAquecimentoMs) delay(100);

  // Descarta o que ficou no buffer (quadros antigos) e espera um quadro novo.
  while (serial_->available() > 0) serial_->read();
  indice_ = 0;

  const uint32_t inicio = millis();
  while (millis() - inicio < timeoutMs) {
    while (serial_->available() > 0) {
      if (alimentar(static_cast<uint8_t>(serial_->read()), saida)) return true;
    }
    delay(10);
  }
  return false;
}

// Monta o quadro de 32 bytes byte a byte: 0x42 0x4D, tamanho, 13 palavras de dados, soma.
// Concentrações (µg/m³) em "ambiente atmosférico": PM1.0 nos bytes 10-11, PM2.5 em 12-13, PM10 em 14-15.
bool SensorPm::alimentar(uint8_t byte, LeituraPm* saida) {
  if (indice_ == 0 && byte != kCabecalho1) return false;
  if (indice_ == 1 && byte != kCabecalho2) {
    indice_ = (byte == kCabecalho1) ? 1 : 0;  // o 0x42 em quadro_[0] continua valendo
    return false;
  }

  quadro_[indice_++] = byte;
  if (indice_ < kTamanhoQuadro) return false;
  indice_ = 0;

  uint16_t soma = 0;
  for (uint8_t i = 0; i < kTamanhoQuadro - 2; ++i) soma += quadro_[i];
  const uint16_t esperado = static_cast<uint16_t>((quadro_[30] << 8) | quadro_[31]);
  if (soma != esperado) return false;  // quadro corrompido: espera o próximo

  saida->pm1 = static_cast<uint16_t>((quadro_[10] << 8) | quadro_[11]);
  saida->pm25 = static_cast<uint16_t>((quadro_[12] << 8) | quadro_[13]);
  saida->pm10 = static_cast<uint16_t>((quadro_[14] << 8) | quadro_[15]);
  return true;
}

}  // namespace sensores
