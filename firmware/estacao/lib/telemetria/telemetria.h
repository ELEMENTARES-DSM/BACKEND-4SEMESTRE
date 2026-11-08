#pragma once
// Monta o JSON do contrato da telemetria (sem Arduino.h): roda no ambiente native.
#include <stddef.h>
#include <stdint.h>

namespace telemetria {

struct Leitura {
  const char* sensor;  // código do sensor cadastrado na plataforma
  float valor;
};

// Passe como nivelBateria quando a estação não mede a bateria (o campo é omitido).
constexpr int kSemBateria = -1;

// Escreve o JSON em `saida` e retorna o tamanho. Retorna 0 (nada escrito) se:
//  - o relógio for inválido (o timestamp não pode ser confiável);
//  - nenhuma leitura for válida (sensor vazio ou valor NaN/infinito são descartados);
//  - o buffer for pequeno demais.
// Formato:
//  {"timestamp":"2026-10-08T21:42:00Z","nivel_bateria":80,"leituras":[{"sensor":"PM25-01","valor":12.0}]}
// nivelBateria fora de 0 a 100 é omitido, porque o servidor rejeita a mensagem inteira.
size_t montar(int64_t epochS, int nivelBateria, const Leitura* leituras, size_t quantidade,
              char* saida, size_t tamanho);

}  // namespace telemetria
