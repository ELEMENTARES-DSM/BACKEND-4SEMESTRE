import {
  createSensorSchema,
  updateSensorSchema,
} from "../../validations/sensor.validation";

describe("sensor.validation: código do sensor obrigatório (US-39)", () => {
  describe("createSensorSchema", () => {
    it("deve aceitar o cadastro quando o código é informado", () => {
      // Quando
      const resultado = createSensorSchema.safeParse({ codigo: "DIR-01", tipo: "Direção do Vento" });

      // Então
      expect(resultado.success).toBe(true);
      expect(resultado.data?.codigo).toBe("DIR-01");
    });

    it("deve rejeitar quando o código está ausente, vazio ou só com espaços", () => {
      expect(createSensorSchema.safeParse({ tipo: "Temperatura" }).success).toBe(false);
      expect(createSensorSchema.safeParse({ codigo: "", tipo: "Temperatura" }).success).toBe(false);
      expect(createSensorSchema.safeParse({ codigo: "   ", tipo: "Temperatura" }).success).toBe(false);
    });

    it("deve apontar o campo codigo no erro quando ele está ausente", () => {
      // Quando
      const resultado = createSensorSchema.safeParse({ tipo: "Temperatura" });

      // Então
      expect(resultado.error?.flatten().fieldErrors).toHaveProperty("codigo");
    });

    it("deve aceitar código com 30 caracteres e rejeitar com 31 (tamanho da coluna)", () => {
      expect(
        createSensorSchema.safeParse({ codigo: "C".repeat(30), tipo: "Temperatura" }).success
      ).toBe(true);
      expect(
        createSensorSchema.safeParse({ codigo: "C".repeat(31), tipo: "Temperatura" }).success
      ).toBe(false);
    });

    it("deve remover os espaços das pontas do código", () => {
      // Quando
      const resultado = createSensorSchema.safeParse({ codigo: "  DIR-01 ", tipo: "Temperatura" });

      // Então
      expect(resultado.data?.codigo).toBe("DIR-01");
    });
  });

  describe("updateSensorSchema", () => {
    it("deve aceitar o PUT sem código (o campo é opcional)", () => {
      // Quando
      const resultado = updateSensorSchema.safeParse({ tipo: "Temperatura" });

      // Então
      expect(resultado.success).toBe(true);
      expect(resultado.data?.codigo).toBeUndefined();
    });

    it("deve aceitar o código no PUT e rejeitar vazio ou com 31 caracteres", () => {
      expect(updateSensorSchema.safeParse({ codigo: "DIR-01", tipo: "Temperatura" }).data?.codigo).toBe("DIR-01");
      expect(updateSensorSchema.safeParse({ codigo: "", tipo: "Temperatura" }).success).toBe(false);
      expect(updateSensorSchema.safeParse({ codigo: "C".repeat(31), tipo: "Temperatura" }).success).toBe(false);
      expect(updateSensorSchema.safeParse({ codigo: "C".repeat(30), tipo: "Temperatura" }).success).toBe(true);
    });
  });
});
