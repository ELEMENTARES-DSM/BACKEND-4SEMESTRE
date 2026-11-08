#include <string.h>
#include <unity.h>

#include "relogio.h"

void setUp(void) {}
void tearDown(void) {}

void test_relogio_invalido_antes_do_ntp(void) {
  TEST_ASSERT_FALSE(relogio::valido(0));
  TEST_ASSERT_FALSE(relogio::valido(1699999999));
  TEST_ASSERT_TRUE(relogio::valido(1700000000));
}

void test_formata_iso8601_do_limite_de_validade(void) {
  char saida[relogio::kTamanhoIso8601];
  TEST_ASSERT_TRUE(relogio::formatarIso8601(1700000000, saida, sizeof(saida)));
  TEST_ASSERT_EQUAL_STRING("2023-11-14T22:13:20Z", saida);
}

void test_formata_iso8601_do_exemplo_do_contrato(void) {
  char saida[relogio::kTamanhoIso8601];
  TEST_ASSERT_TRUE(relogio::formatarIso8601(1791495720, saida, sizeof(saida)));
  TEST_ASSERT_EQUAL_STRING("2026-10-08T21:42:00Z", saida);
}

void test_formata_iso8601_em_ano_bissexto(void) {
  char saida[relogio::kTamanhoIso8601];
  TEST_ASSERT_TRUE(relogio::formatarIso8601(1709208000, saida, sizeof(saida)));
  TEST_ASSERT_EQUAL_STRING("2024-02-29T12:00:00Z", saida);
}

void test_formata_iso8601_na_virada_do_ano(void) {
  char saida[relogio::kTamanhoIso8601];
  TEST_ASSERT_TRUE(relogio::formatarIso8601(1798761599, saida, sizeof(saida)));
  TEST_ASSERT_EQUAL_STRING("2026-12-31T23:59:59Z", saida);
  TEST_ASSERT_TRUE(relogio::formatarIso8601(1798761600, saida, sizeof(saida)));
  TEST_ASSERT_EQUAL_STRING("2027-01-01T00:00:00Z", saida);
}

void test_formata_iso8601_recusa_relogio_invalido_e_buffer_pequeno(void) {
  char saida[relogio::kTamanhoIso8601];
  TEST_ASSERT_FALSE(relogio::formatarIso8601(0, saida, sizeof(saida)));
  char pequeno[20];
  TEST_ASSERT_FALSE(relogio::formatarIso8601(1791495720, pequeno, sizeof(pequeno)));
  TEST_ASSERT_FALSE(relogio::formatarIso8601(1791495720, nullptr, 21));
}

void test_proximo_ciclo_alinhado_ao_relogio(void) {
  TEST_ASSERT_EQUAL_UINT32(300, relogio::segundosAteProximoCiclo(1791495600, 300));  // exatamente no ciclo
  TEST_ASSERT_EQUAL_UINT32(299, relogio::segundosAteProximoCiclo(1791495601, 300));
  TEST_ASSERT_EQUAL_UINT32(1, relogio::segundosAteProximoCiclo(1791495899, 300));
  TEST_ASSERT_EQUAL_UINT32(1, relogio::segundosAteProximoCiclo(1791495720, 0));  // intervalo inválido
}

int main(int, char **) {
  UNITY_BEGIN();
  RUN_TEST(test_relogio_invalido_antes_do_ntp);
  RUN_TEST(test_formata_iso8601_do_limite_de_validade);
  RUN_TEST(test_formata_iso8601_do_exemplo_do_contrato);
  RUN_TEST(test_formata_iso8601_em_ano_bissexto);
  RUN_TEST(test_formata_iso8601_na_virada_do_ano);
  RUN_TEST(test_formata_iso8601_recusa_relogio_invalido_e_buffer_pequeno);
  RUN_TEST(test_proximo_ciclo_alinhado_ao_relogio);
  return UNITY_END();
}
