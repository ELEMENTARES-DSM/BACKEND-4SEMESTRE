import {
  createSensorSchema,
  updateSensorSchema,
} from "../../validations/sensor.validation";

describe("sensor.validation: grandeza vinda do catálogo (US-39)", () => {
  describe("createSensorSchema", () => {
    it("deve aceitar uma grandeza fora da lista antiga quando o nome é de uma grandeza do catálogo", () => {
      // Dado
      const entrada = { tipo: "Direção do Vento", codigo: "DIR-01" };

      // Quando
      const resultado = createSensorSchema.safeParse(entrada);

      // Então
      expect(resultado.success).toBe(true);
      expect(resultado.data?.tipo).toBe("Direção do Vento");
    });

    it("deve remover os espaços das pontas do tipo", () => {
      // Quando
      const resultado = createSensorSchema.safeParse({ tipo: "  Precipitação " });

      // Então
      expect(resultado.data?.tipo).toBe("Precipitação");
    });

    it("deve rejeitar quando o tipo está ausente, vazio ou só com espaços", () => {
      expect(createSensorSchema.safeParse({}).success).toBe(false);
      expect(createSensorSchema.safeParse({ tipo: "" }).success).toBe(false);
      expect(createSensorSchema.safeParse({ tipo: "   " }).success).toBe(false);
    });

    it("deve aceitar tipo com 100 caracteres e rejeitar com 101 (tamanho do nome no catálogo)", () => {
      expect(createSensorSchema.safeParse({ tipo: "a".repeat(100) }).success).toBe(true);
      expect(createSensorSchema.safeParse({ tipo: "a".repeat(101) }).success).toBe(false);
    });

    it("deve manter fator e ganho opcionais, com os nomes atuais", () => {
      // Quando
      const resultado = createSensorSchema.safeParse({ tipo: "Temperatura", fator: 2, ganho: -1 });

      // Então
      expect(resultado.data).toMatchObject({ fator: 2, ganho: -1 });
    });
  });

  describe("updateSensorSchema", () => {
    it("deve aceitar grandeza nova no PUT e descartar codigo e nome", () => {
      // Dado
      const entrada = { tipo: "Pressão Atmosférica", codigo: "X", nome: "Y" };

      // Quando
      const resultado = updateSensorSchema.safeParse(entrada);

      // Então
      expect(resultado.data).toEqual({ tipo: "Pressão Atmosférica", unidade_leitura: null });
    });
  });
});
