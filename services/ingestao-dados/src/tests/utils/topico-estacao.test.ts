import { extrairMacDoTopico } from "../../utils/topico-estacao";

// Unitário de extrairMacDoTopico: função pura.
describe("extrairMacDoTopico", () => {
  const mac = "aabbccddeeff";

  it("deve devolver o MAC quando o tópico é pulso/estacoes/<mac>/telemetria", () => {
    // Dado (Arrange)
    const topico = `pulso/estacoes/${mac}/telemetria`;

    // Quando (Act)
    const resultado = extrairMacDoTopico(topico);

    // Então (Assert)
    expect(resultado).toBe(mac);
  });

  it("deve devolver o MAC em minúsculas quando o firmware publica em maiúsculas", () => {
    // Dado (Arrange)
    const maiusculo = mac.toUpperCase();

    // Quando (Act)
    const resultado = extrairMacDoTopico(`pulso/estacoes/${maiusculo}/telemetria`);

    // Então (Assert)
    expect(resultado).toBe(mac);
  });

  it("deve devolver null quando o tópico não tem MAC", () => {
    // Quando (Act)
    const resultado = extrairMacDoTopico("pulso/estacoes/telemetria");

    // Então (Assert)
    expect(resultado).toBeNull();
  });

  it("deve devolver null quando o MAC está mal formado", () => {
    // Quando (Act)
    const resultado = extrairMacDoTopico("pulso/estacoes/aa:bb:cc:dd:ee:ff/telemetria");

    // Então (Assert)
    expect(resultado).toBeNull();
  });

  it("deve devolver null para o UUID antigo, que não é mais o identificador do tópico", () => {
    // Quando (Act)
    const resultado = extrairMacDoTopico("pulso/estacoes/8723c462-e79c-4e58-9751-eef8868a5312/telemetria");

    // Então (Assert)
    expect(resultado).toBeNull();
  });

  it.each([`pulso/estacoes/${mac}/telemetria/extra`, `pulso/estacoes/${mac}/status`])(
    "deve devolver null quando o tópico tem níveis extras ou é de outro tipo: %s",
    (topico) => {
      // Quando (Act)
      const resultado = extrairMacDoTopico(topico);

      // Então (Assert)
      expect(resultado).toBeNull();
    },
  );
});
