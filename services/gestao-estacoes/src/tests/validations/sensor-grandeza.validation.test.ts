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
      const resultado = createSensorSchema.safeParse({ codigo: "X-01", tipo: "  Precipitação " });

      // Então
      expect(resultado.data?.tipo).toBe("Precipitação");
    });

    it("deve rejeitar quando o tipo está ausente, vazio ou só com espaços", () => {
      expect(createSensorSchema.safeParse({ codigo: "X-01" }).success).toBe(false);
      expect(createSensorSchema.safeParse({ codigo: "X-01", tipo: "" }).success).toBe(false);
      expect(createSensorSchema.safeParse({ codigo: "X-01", tipo: "   " }).success).toBe(false);
    });

    it("deve aceitar tipo com 100 caracteres e rejeitar com 101 (tamanho do nome no catálogo)", () => {
      expect(createSensorSchema.safeParse({ codigo: "X-01", tipo: "a".repeat(100) }).success).toBe(true);
      expect(createSensorSchema.safeParse({ codigo: "X-01", tipo: "a".repeat(101) }).success).toBe(false);
    });

    it("deve aceitar offset negativo e zero (ex.: -273,15 para Kelvin)", () => {
      expect(
        createSensorSchema.safeParse({ codigo: "X-01", tipo: "Temperatura", offset: -273.15 }).data?.offset
      ).toBe(-273.15);
      expect(createSensorSchema.safeParse({ codigo: "X-01", tipo: "Temperatura", offset: 0 }).data?.offset).toBe(0);
    });

    it("deve rejeitar fator_conversao e offset que não são número", () => {
      expect(
        createSensorSchema.safeParse({ codigo: "X-01", tipo: "Temperatura", fator_conversao: "2" }).success
      ).toBe(false);
      expect(createSensorSchema.safeParse({ codigo: "X-01", tipo: "Temperatura", offset: "0" }).success).toBe(false);
    });

    it("deve descartar os nomes antigos fator e ganho (o front precisa ir junto no mesmo release)", () => {
      // Quando
      const resultado = createSensorSchema.safeParse({ codigo: "X-01", tipo: "Temperatura", fator: 2, ganho: -1 });

      // Então: sem erro, mas os valores não são lidos; o service grava fator 1 e offset 0
      expect(resultado.success).toBe(true);
      expect(resultado.data).not.toHaveProperty("fator");
      expect(resultado.data).not.toHaveProperty("ganho");
      expect(resultado.data?.fator_conversao).toBeUndefined();
      expect(resultado.data?.offset).toBeUndefined();
    });

    it("deve aceitar fator_conversao e offset opcionais", () => {
      // Quando
      const resultado = createSensorSchema.safeParse({ codigo: "X-01", tipo: "Temperatura", fator_conversao: 2, offset: -1 });

      // Então
      expect(resultado.data).toMatchObject({ fator_conversao: 2, offset: -1 });
    });
  });

  describe("updateSensorSchema", () => {
    it("deve aceitar grandeza nova no PUT, manter o código e descartar o nome", () => {
      // Dado
      const entrada = { tipo: "Pressão Atmosférica", codigo: "X", nome: "Y" };

      // Quando
      const resultado = updateSensorSchema.safeParse(entrada);

      // Então
      expect(resultado.data).toEqual({ tipo: "Pressão Atmosférica", codigo: "X", unidade_leitura: null });
    });
  });
});
