import {
  createSensorSchema,
  updateSensorSchema,
} from "../../validations/sensor.validation";

describe("sensor.validation: unidade_leitura (US-39)", () => {
  describe("createSensorSchema", () => {
    it("deve aceitar a unidade de leitura e remover os espaços das pontas", () => {
      // Dado
      const entrada = { tipo: "Temperatura", unidade_leitura: " K " };

      // Quando
      const resultado = createSensorSchema.safeParse(entrada);

      // Então
      expect(resultado.success).toBe(true);
      expect(resultado.data?.unidade_leitura).toBe("K");
    });

    it("deve virar null quando o campo está ausente, nulo, vazio ou só com espaços", () => {
      expect(createSensorSchema.safeParse({ tipo: "Temperatura" }).data?.unidade_leitura).toBeNull();
      expect(
        createSensorSchema.safeParse({ tipo: "Temperatura", unidade_leitura: null }).data?.unidade_leitura
      ).toBeNull();
      expect(
        createSensorSchema.safeParse({ tipo: "Temperatura", unidade_leitura: "" }).data?.unidade_leitura
      ).toBeNull();
      expect(
        createSensorSchema.safeParse({ tipo: "Temperatura", unidade_leitura: "   " }).data?.unidade_leitura
      ).toBeNull();
    });

    it("deve aceitar 20 caracteres e rejeitar 21", () => {
      expect(
        createSensorSchema.safeParse({ tipo: "Temperatura", unidade_leitura: "u".repeat(20) }).success
      ).toBe(true);
      expect(
        createSensorSchema.safeParse({ tipo: "Temperatura", unidade_leitura: "u".repeat(21) }).success
      ).toBe(false);
    });

    it("deve rejeitar quando a unidade de leitura não é texto", () => {
      expect(
        createSensorSchema.safeParse({ tipo: "Temperatura", unidade_leitura: 5 }).success
      ).toBe(false);
    });

    it("deve ignorar o nome em camelCase (o JSON é snake_case)", () => {
      // Quando
      const resultado = createSensorSchema.safeParse({ tipo: "Temperatura", unidadeLeitura: "K" });

      // Então
      expect(resultado.data?.unidade_leitura).toBeNull();
    });
  });

  describe("updateSensorSchema", () => {
    it("deve aceitar a unidade de leitura no PUT e voltar a null quando ela é omitida", () => {
      expect(
        updateSensorSchema.safeParse({ tipo: "Temperatura", unidade_leitura: "K" }).data?.unidade_leitura
      ).toBe("K");
      expect(updateSensorSchema.safeParse({ tipo: "Temperatura" }).data?.unidade_leitura).toBeNull();
    });
  });
});
