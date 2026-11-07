// Teste de fumaça: garante que o ambiente native (Unity + ArduinoJson) roda no CI.
// Os testes reais do relógio entram na 26.03.
#include <ArduinoJson.h>
#include <string>
#include <unity.h>

void setUp(void) {}
void tearDown(void) {}

void test_unity_executa(void) {
  TEST_ASSERT_EQUAL_INT(4, 2 + 2);
}

void test_arduinojson_disponivel_no_native(void) {
  JsonDocument doc;
  doc["ok"] = true;
  std::string saida;
  serializeJson(doc, saida);
  TEST_ASSERT_EQUAL_STRING("{\"ok\":true}", saida.c_str());
}

int main(int, char **) {
  UNITY_BEGIN();
  RUN_TEST(test_unity_executa);
  RUN_TEST(test_arduinojson_disponivel_no_native);
  return UNITY_END();
}
