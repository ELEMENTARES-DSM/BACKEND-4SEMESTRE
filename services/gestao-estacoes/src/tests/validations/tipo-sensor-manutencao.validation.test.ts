import {
  tipoSensorIdParamSchema,
  updateTipoSensorSchema,
} from "../../validations/tipo-sensor.validation";

describe("tipo-sensor.validation: PUT e DELETE (US-39)", () => {
  describe("updateTipoSensorSchema", () => {
    it.each([
      ["unidade", { unidade: "K" }],
      ["faixa_min", { faixa_min: -10 }],
      ["faixa_max", { faixa_max: 120 }],
      ["agregacao", { agregacao: "soma" }],
    ])("deve aceitar o corpo com só o campo %s", (_campo, corpo) => {
      // Quando
      const resultado = updateTipoSensorSchema.safeParse(corpo);

      // Então
      expect(resultado.success).toBe(true);
      expect(resultado.data).toEqual(corpo);
    });

    it("deve aceitar todos os campos de uma vez", () => {
      // Quando
      const resultado = updateTipoSensorSchema.safeParse({
        unidade: "%",
        faixa_min: 0,
        faixa_max: 100,
        agregacao: "media",
      });

      // Então
      expect(resultado.success).toBe(true);
    });

    it("deve rejeitar o corpo vazio, apontando que falta ao menos um campo", () => {
      // Quando
      const resultado = updateTipoSensorSchema.safeParse({});

      // Então
      expect(resultado.success).toBe(false);
      expect(resultado.error?.flatten().fieldErrors).toHaveProperty("corpo");
    });

    it("deve rejeitar o nome com a mensagem de que ele não pode ser alterado", () => {
      // Quando
      const resultado = updateTipoSensorSchema.safeParse({ nome: "Outro nome", unidade: "K" });

      // Então
      expect(resultado.success).toBe(false);
      expect(resultado.error?.flatten().fieldErrors.nome).toEqual([
        "O nome da grandeza não pode ser alterado.",
      ]);
    });

    it("deve rejeitar campo desconhecido (corpo estrito)", () => {
      // Quando
      const resultado = updateTipoSensorSchema.safeParse({ unidade: "K", id: "x" });

      // Então
      expect(resultado.success).toBe(false);
    });

    it("deve aceitar unidade com 20 caracteres e rejeitar com 21 ou vazia", () => {
      expect(updateTipoSensorSchema.safeParse({ unidade: "u".repeat(20) }).success).toBe(true);
      expect(updateTipoSensorSchema.safeParse({ unidade: "u".repeat(21) }).success).toBe(false);
      expect(updateTipoSensorSchema.safeParse({ unidade: "   " }).success).toBe(false);
    });

    it("deve rejeitar agregação fora da lista", () => {
      expect(updateTipoSensorSchema.safeParse({ agregacao: "mediana" }).success).toBe(false);
    });

    it("deve aceitar 2 casas decimais na faixa e rejeitar 3, e respeitar o limite do banco", () => {
      expect(updateTipoSensorSchema.safeParse({ faixa_min: 0.01 }).success).toBe(true);
      expect(updateTipoSensorSchema.safeParse({ faixa_min: 0.001 }).success).toBe(false);
      expect(updateTipoSensorSchema.safeParse({ faixa_max: 9999999999.99 }).success).toBe(true);
      expect(updateTipoSensorSchema.safeParse({ faixa_max: 10000000000 }).success).toBe(false);
    });
  });

  describe("tipoSensorIdParamSchema", () => {
    it("deve aceitar um UUID e rejeitar outro texto", () => {
      expect(
        tipoSensorIdParamSchema.safeParse({ id: "5549e54b-346e-4a87-8f7d-d2604c878530" }).success
      ).toBe(true);
      expect(tipoSensorIdParamSchema.safeParse({ id: "temperatura" }).success).toBe(false);
    });
  });
});
