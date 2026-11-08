#pragma once
// Lógica pura do relógio (sem Arduino.h): roda no ambiente native.
#include <stddef.h>
#include <stdint.h>

namespace relogio {

// Data anterior a esta (14/11/2023) significa relógio ainda não ajustado (ex.: 1970).
constexpr int64_t kEpochMinimoValido = 1700000000;

// "YYYY-MM-DDTHH:MM:SSZ" + terminador.
constexpr size_t kTamanhoIso8601 = 21;

bool valido(int64_t epochS);

// Escreve o instante em UTC no formato ISO 8601 ("2026-10-08T21:42:00Z").
// Retorna false se o relógio for inválido ou o buffer tiver menos de kTamanhoIso8601 bytes.
bool formatarIso8601(int64_t epochS, char* saida, size_t tamanho);

// Segundos até o próximo múltiplo de intervaloS, para alinhar as leituras ao relógio
// (com 300 s: :00, :05, :10...). Sempre entre 1 e intervaloS.
uint32_t segundosAteProximoCiclo(int64_t epochS, uint32_t intervaloS);

}  // namespace relogio
