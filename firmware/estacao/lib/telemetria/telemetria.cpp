#include "telemetria.h"

#include <ArduinoJson.h>

#include <cmath>

#include "relogio.h"

namespace telemetria {

size_t montar(int64_t epochS, int nivelBateria, const Leitura* leituras, size_t quantidade,
              char* saida, size_t tamanho) {
  if (saida == nullptr || leituras == nullptr || tamanho == 0) return 0;

  char timestamp[relogio::kTamanhoIso8601];
  if (!relogio::formatarIso8601(epochS, timestamp, sizeof(timestamp))) return 0;

  JsonDocument doc;
  doc["timestamp"] = timestamp;  // texto ISO 8601: o servidor não aceita número aqui
  if (nivelBateria >= 0 && nivelBateria <= 100) doc["nivel_bateria"] = nivelBateria;

  JsonArray lista = doc["leituras"].to<JsonArray>();
  for (size_t i = 0; i < quantidade; ++i) {
    const Leitura& leitura = leituras[i];
    if (leitura.sensor == nullptr || leitura.sensor[0] == '\0') continue;
    if (!std::isfinite(leitura.valor)) continue;  // NaN virava null no JSON e a mensagem era rejeitada
    JsonObject item = lista.add<JsonObject>();
    item["sensor"] = leitura.sensor;
    item["valor"] = leitura.valor;
  }
  if (lista.size() == 0) return 0;

  if (measureJson(doc) >= tamanho) return 0;
  return serializeJson(doc, saida, tamanho);
}

}  // namespace telemetria
