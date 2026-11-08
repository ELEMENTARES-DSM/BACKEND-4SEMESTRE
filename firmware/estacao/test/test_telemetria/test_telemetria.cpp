// Confere que o JSON montado passa nas regras do ValidarPayloadService (ingestao-dados):
// timestamp em texto ISO 8601, leituras não vazia com sensor texto e valor numérico,
// nivel_bateria opcional, inteiro de 0 a 100.
#include <ArduinoJson.h>
#include <math.h>
#include <stdio.h>
#include <string.h>
#include <unity.h>

#include "telemetria.h"

static const int64_t kEpoch = 1791495720;  // 2026-10-08T21:42:00Z

void setUp(void) {}
void tearDown(void) {}

static void montarEParsear(JsonDocument& doc, int bateria, const telemetria::Leitura* leituras, size_t n) {
  char saida[256];
  const size_t tamanho = telemetria::montar(kEpoch, bateria, leituras, n, saida, sizeof(saida));
  TEST_ASSERT_GREATER_THAN(0, tamanho);
  TEST_ASSERT_EQUAL(DeserializationError::Ok, deserializeJson(doc, saida).code());
}

void test_payload_valido_com_bateria(void) {
  const telemetria::Leitura leituras[] = {{"PM25-01", 12.0f}};
  JsonDocument doc;
  montarEParsear(doc, 80, leituras, 1);

  TEST_ASSERT_TRUE(doc["timestamp"].is<const char*>());
  TEST_ASSERT_EQUAL_STRING("2026-10-08T21:42:00Z", doc["timestamp"].as<const char*>());
  TEST_ASSERT_TRUE(doc["nivel_bateria"].is<int>());
  TEST_ASSERT_EQUAL_INT(80, doc["nivel_bateria"].as<int>());
  TEST_ASSERT_EQUAL_UINT(1, doc["leituras"].size());
  TEST_ASSERT_TRUE(doc["leituras"][0]["sensor"].is<const char*>());
  TEST_ASSERT_EQUAL_STRING("PM25-01", doc["leituras"][0]["sensor"].as<const char*>());
  TEST_ASSERT_TRUE(doc["leituras"][0]["valor"].is<float>());
  TEST_ASSERT_EQUAL_FLOAT(12.0f, doc["leituras"][0]["valor"].as<float>());
}

void test_bateria_omitida_quando_nao_medida(void) {
  const telemetria::Leitura leituras[] = {{"PM25-01", 12.0f}};
  char saida[256];
  TEST_ASSERT_GREATER_THAN(0, telemetria::montar(kEpoch, telemetria::kSemBateria, leituras, 1, saida, sizeof(saida)));
  TEST_ASSERT_NULL(strstr(saida, "nivel_bateria"));
}

void test_bateria_fora_da_faixa_e_omitida_em_vez_de_derrubar_a_mensagem(void) {
  const telemetria::Leitura leituras[] = {{"PM25-01", 12.0f}};
  char saida[256];
  TEST_ASSERT_GREATER_THAN(0, telemetria::montar(kEpoch, 140, leituras, 1, saida, sizeof(saida)));
  TEST_ASSERT_NULL(strstr(saida, "nivel_bateria"));
  TEST_ASSERT_GREATER_THAN(0, telemetria::montar(kEpoch, -5, leituras, 1, saida, sizeof(saida)));
  TEST_ASSERT_NULL(strstr(saida, "nivel_bateria"));
}

void test_varias_leituras_na_ordem(void) {
  const telemetria::Leitura leituras[] = {{"PM25-01", 12.5f}, {"TEMP-01", 25.4f}};
  JsonDocument doc;
  montarEParsear(doc, telemetria::kSemBateria, leituras, 2);
  TEST_ASSERT_EQUAL_UINT(2, doc["leituras"].size());
  TEST_ASSERT_EQUAL_STRING("TEMP-01", doc["leituras"][1]["sensor"].as<const char*>());
}

void test_leitura_invalida_e_descartada(void) {
  const telemetria::Leitura leituras[] = {{"PM25-01", NAN}, {"", 1.0f}, {nullptr, 1.0f}, {"TEMP-01", 25.0f}};
  JsonDocument doc;
  montarEParsear(doc, telemetria::kSemBateria, leituras, 4);
  TEST_ASSERT_EQUAL_UINT(1, doc["leituras"].size());
  TEST_ASSERT_EQUAL_STRING("TEMP-01", doc["leituras"][0]["sensor"].as<const char*>());
}

void test_sem_leitura_valida_nao_gera_payload(void) {
  const telemetria::Leitura leituras[] = {{"PM25-01", NAN}};
  char saida[256];
  TEST_ASSERT_EQUAL_UINT(0, telemetria::montar(kEpoch, telemetria::kSemBateria, leituras, 1, saida, sizeof(saida)));
  TEST_ASSERT_EQUAL_UINT(0, telemetria::montar(kEpoch, telemetria::kSemBateria, leituras, 0, saida, sizeof(saida)));
}

void test_relogio_invalido_nao_gera_payload(void) {
  const telemetria::Leitura leituras[] = {{"PM25-01", 12.0f}};
  char saida[256];
  TEST_ASSERT_EQUAL_UINT(0, telemetria::montar(0, telemetria::kSemBateria, leituras, 1, saida, sizeof(saida)));
}

void test_buffer_pequeno_nao_gera_payload_truncado(void) {
  const telemetria::Leitura leituras[] = {{"PM25-01", 12.0f}};
  char pequeno[32];
  TEST_ASSERT_EQUAL_UINT(0, telemetria::montar(kEpoch, telemetria::kSemBateria, leituras, 1, pequeno, sizeof(pequeno)));
}

// Gera o exemplo do contrato em test/contrato/telemetria.json (o ingestao-dados pode testar contra ele).
void test_gera_arquivo_de_contrato(void) {
  const telemetria::Leitura leituras[] = {{"PM25-01", 12.0f}};
  char saida[256];
  const size_t tamanho = telemetria::montar(kEpoch, 80, leituras, 1, saida, sizeof(saida));
  TEST_ASSERT_GREATER_THAN(0, tamanho);

  FILE* arquivo = fopen("test/contrato/telemetria.json", "w");
  if (arquivo == nullptr) TEST_IGNORE_MESSAGE("rode de firmware/estacao para gerar test/contrato/telemetria.json");
  fputs(saida, arquivo);
  fputc('\n', arquivo);
  fclose(arquivo);
}

int main(int, char **) {
  UNITY_BEGIN();
  RUN_TEST(test_payload_valido_com_bateria);
  RUN_TEST(test_bateria_omitida_quando_nao_medida);
  RUN_TEST(test_bateria_fora_da_faixa_e_omitida_em_vez_de_derrubar_a_mensagem);
  RUN_TEST(test_varias_leituras_na_ordem);
  RUN_TEST(test_leitura_invalida_e_descartada);
  RUN_TEST(test_sem_leitura_valida_nao_gera_payload);
  RUN_TEST(test_relogio_invalido_nao_gera_payload);
  RUN_TEST(test_buffer_pequeno_nao_gera_payload_truncado);
  RUN_TEST(test_gera_arquivo_de_contrato);
  return UNITY_END();
}
