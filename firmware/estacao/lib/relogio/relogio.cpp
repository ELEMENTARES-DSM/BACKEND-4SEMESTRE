#include "relogio.h"

namespace relogio {

namespace {

// Escreve `valor` em `digitos` casas, com zeros à esquerda.
void escrever(char* destino, int valor, int digitos) {
  for (int i = digitos - 1; i >= 0; --i) {
    destino[i] = static_cast<char>('0' + (valor % 10));
    valor /= 10;
  }
}

}  // namespace

bool valido(int64_t epochS) {
  return epochS >= kEpochMinimoValido;
}

bool formatarIso8601(int64_t epochS, char* saida, size_t tamanho) {
  if (saida == nullptr || tamanho < kTamanhoIso8601 || !valido(epochS)) return false;

  const int64_t dias = epochS / 86400;
  const int segundosDoDia = static_cast<int>(epochS % 86400);

  // Data civil a partir dos dias desde 1970-01-01 (algoritmo de Howard Hinnant).
  const int64_t z = dias + 719468;
  const int64_t era = z / 146097;  // z > 0: o relógio é válido
  const int64_t doe = z - era * 146097;
  const int64_t yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  const int64_t doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  const int64_t mp = (5 * doy + 2) / 153;
  const int dia = static_cast<int>(doy - (153 * mp + 2) / 5 + 1);
  const int mes = static_cast<int>(mp < 10 ? mp + 3 : mp - 9);
  const int ano = static_cast<int>(yoe + era * 400 + (mes <= 2 ? 1 : 0));

  escrever(saida + 0, ano, 4);
  saida[4] = '-';
  escrever(saida + 5, mes, 2);
  saida[7] = '-';
  escrever(saida + 8, dia, 2);
  saida[10] = 'T';
  escrever(saida + 11, segundosDoDia / 3600, 2);
  saida[13] = ':';
  escrever(saida + 14, (segundosDoDia % 3600) / 60, 2);
  saida[16] = ':';
  escrever(saida + 17, segundosDoDia % 60, 2);
  saida[19] = 'Z';
  saida[20] = '\0';
  return true;
}

uint32_t segundosAteProximoCiclo(int64_t epochS, uint32_t intervaloS) {
  if (intervaloS == 0) return 1;
  const uint32_t resto = static_cast<uint32_t>(static_cast<uint64_t>(epochS) % intervaloS);
  return intervaloS - resto;
}

}  // namespace relogio
