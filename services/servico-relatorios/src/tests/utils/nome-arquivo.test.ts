import { describe, it, expect } from "@jest/globals";
import { nomeArquivoCsv, nomeNoEndereco } from "../../utils/nome-arquivo";

describe("nome-arquivo (US-31)", () => {
  describe("nomeNoEndereco", () => {
    it.each([
      ["São José dos Campos", "sao-jose-dos-campos"],
      ["Jacareí", "jacarei"],
      [" Santa Branca", "santa-branca"],
    ])("deve escrever %s como %s quando monta o nome no endereço", (municipio, esperado) => {
      // Dado:
      const nome = municipio;

      // Quando:
      const resultado = nomeNoEndereco(nome);

      // Então:
      expect(resultado).toBe(esperado);
    });
  });

  describe("nomeArquivoCsv", () => {
    it("deve seguir o padrão pulso-urbano_medicoes_<municipio>_<inicio>_<fim>.csv quando monta o arquivo", () => {
      // Dado:
      const municipio = "São José dos Campos";

      // Quando:
      const nome = nomeArquivoCsv(municipio, "2026-11-01", "2026-11-06");

      // Então:
      expect(nome).toBe("pulso-urbano_medicoes_sao-jose-dos-campos_2026-11-01_2026-11-06.csv");
    });
  });
});
