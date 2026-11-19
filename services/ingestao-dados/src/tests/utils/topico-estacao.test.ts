import { extrairEstacaoId } from "../../utils/topico-estacao";

// Unitário de extrairEstacaoId: função pura.
describe("extrairEstacaoId", () => {
  const uuid = "8723c462-e79c-4e58-9751-eef8868a5312";

  it("deve devolver o UUID quando o tópico é pulso/estacoes/<uuid>/telemetria", () => {
    // Dado (Arrange)
    const topico = `pulso/estacoes/${uuid}/telemetria`;

    // Quando (Act)
    const estacao = extrairEstacaoId(topico);

    // Então (Assert)
    expect(estacao).toBe(uuid);
  });

  it("deve devolver o UUID como veio quando ele está em maiúsculas", () => {
    // Dado (Arrange)
    const maiusculo = uuid.toUpperCase();

    // Quando (Act)
    const estacao = extrairEstacaoId(`pulso/estacoes/${maiusculo}/telemetria`);

    // Então (Assert)
    expect(estacao).toBe(maiusculo);
  });

  it("deve devolver null quando o tópico não tem UUID", () => {
    // Dado (Arrange)
    // Quando (Act)
    const estacao = extrairEstacaoId("pulso/estacoes/telemetria");

    // Então (Assert)
    expect(estacao).toBeNull();
  });

  it("deve devolver null quando o UUID está mal formado", () => {
    // Dado (Arrange)
    // Quando (Act)
    const estacao = extrairEstacaoId("pulso/estacoes/est-001/telemetria");

    // Então (Assert)
    expect(estacao).toBeNull();
  });

  it.each([`pulso/estacoes/${uuid}/telemetria/extra`, `pulso/estacoes/${uuid}/status`])(
    "deve devolver null quando o tópico tem níveis extras ou é de outro tipo: %s",
    (topico) => {
      // Dado (Arrange)
      // Quando (Act)
      const estacao = extrairEstacaoId(topico);

      // Então (Assert)
      expect(estacao).toBeNull();
    },
  );
});
