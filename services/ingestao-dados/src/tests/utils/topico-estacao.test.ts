import { extrairEstacaoId } from "../../utils/topico-estacao";

describe("extrairEstacaoId", () => {
  const uuid = "8723c462-e79c-4e58-9751-eef8868a5312";

  test("extrai o UUID de um tópico de telemetria válido", () => {
    expect(extrairEstacaoId(`pulso/estacoes/${uuid}/telemetria`)).toBe(uuid);
  });

  test("aceita UUID em maiúsculas", () => {
    const maiusculo = uuid.toUpperCase();
    expect(extrairEstacaoId(`pulso/estacoes/${maiusculo}/telemetria`)).toBe(maiusculo);
  });

  test("rejeita tópico sem UUID", () => {
    expect(extrairEstacaoId("pulso/estacoes/telemetria")).toBeNull();
  });

  test("rejeita UUID mal formado", () => {
    expect(extrairEstacaoId("pulso/estacoes/est-001/telemetria")).toBeNull();
  });

  test("rejeita tópico com níveis extras ou de outro tipo", () => {
    expect(extrairEstacaoId(`pulso/estacoes/${uuid}/telemetria/extra`)).toBeNull();
    expect(extrairEstacaoId(`pulso/estacoes/${uuid}/status`)).toBeNull();
  });
});
