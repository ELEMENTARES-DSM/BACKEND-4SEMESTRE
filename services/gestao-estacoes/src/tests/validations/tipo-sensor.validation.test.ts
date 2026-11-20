import { createTipoSensorSchema } from "../../validations/tipo-sensor.validation";

const payloadValido = {
  nome: "Nebulosidade",
  unidade: "%",
  faixa_min: 0,
  faixa_max: 100,
};

describe("tipo-sensor.validation (US-39)", () => {
  describe("createTipoSensorSchema", () => {
    it("deve aceitar o payload e usar a agregação 'media' quando ela é omitida", () => {
      // Dado
      const entrada = { ...payloadValido };

      // Quando
      const resultado = createTipoSensorSchema.safeParse(entrada);

      // Então
      expect(resultado.success).toBe(true);
      expect(resultado.data).toEqual({ ...payloadValido, agregacao: "media" });
    });

    it.each(["media", "soma", "media_circular"])(
      "deve aceitar a agregação '%s'",
      (agregacao) => {
        // Dado
        const entrada = { ...payloadValido, agregacao };

        // Quando
        const resultado = createTipoSensorSchema.safeParse(entrada);

        // Então
        expect(resultado.success).toBe(true);
      }
    );

    it("deve rejeitar quando a agregação não é uma das permitidas", () => {
      // Dado
      const entrada = { ...payloadValido, agregacao: "mediana" };

      // Quando
      const resultado = createTipoSensorSchema.safeParse(entrada);

      // Então
      expect(resultado.success).toBe(false);
    });

    it.each(["nome", "unidade", "faixa_min", "faixa_max"])(
      "deve rejeitar quando o campo obrigatório '%s' está ausente",
      (campo) => {
        // Dado
        const entrada: Record<string, unknown> = { ...payloadValido };
        delete entrada[campo];

        // Quando
        const resultado = createTipoSensorSchema.safeParse(entrada);

        // Então
        expect(resultado.success).toBe(false);
      }
    );

    it("deve remover os espaços das pontas do nome e da unidade", () => {
      // Dado
      const entrada = { ...payloadValido, nome: "  Nebulosidade  ", unidade: " % " };

      // Quando
      const resultado = createTipoSensorSchema.safeParse(entrada);

      // Então
      expect(resultado.data).toMatchObject({ nome: "Nebulosidade", unidade: "%" });
    });

    describe("limites de tamanho", () => {
      it("deve aceitar nome com 100 caracteres e rejeitar com 101", () => {
        expect(
          createTipoSensorSchema.safeParse({ ...payloadValido, nome: "a".repeat(100) }).success
        ).toBe(true);
        expect(
          createTipoSensorSchema.safeParse({ ...payloadValido, nome: "a".repeat(101) }).success
        ).toBe(false);
      });

      it("deve rejeitar nome vazio ou só com espaços", () => {
        expect(createTipoSensorSchema.safeParse({ ...payloadValido, nome: "" }).success).toBe(false);
        expect(createTipoSensorSchema.safeParse({ ...payloadValido, nome: "   " }).success).toBe(false);
      });

      it("deve aceitar unidade com 20 caracteres e rejeitar com 21", () => {
        expect(
          createTipoSensorSchema.safeParse({ ...payloadValido, unidade: "u".repeat(20) }).success
        ).toBe(true);
        expect(
          createTipoSensorSchema.safeParse({ ...payloadValido, unidade: "u".repeat(21) }).success
        ).toBe(false);
      });
    });

    describe("faixa física (NUMERIC(12,2))", () => {
      it("deve aceitar o maior e o menor valor que o banco guarda", () => {
        const resultado = createTipoSensorSchema.safeParse({
          ...payloadValido,
          faixa_min: -9999999999.99,
          faixa_max: 9999999999.99,
        });

        expect(resultado.success).toBe(true);
      });

      it("deve rejeitar valor logo acima do limite do banco", () => {
        expect(
          createTipoSensorSchema.safeParse({ ...payloadValido, faixa_max: 10000000000 }).success
        ).toBe(false);
        expect(
          createTipoSensorSchema.safeParse({ ...payloadValido, faixa_min: -10000000000 }).success
        ).toBe(false);
      });

      it("deve aceitar 2 casas decimais e rejeitar 3", () => {
        expect(
          createTipoSensorSchema.safeParse({ ...payloadValido, faixa_min: 0.01 }).success
        ).toBe(true);
        expect(
          createTipoSensorSchema.safeParse({ ...payloadValido, faixa_min: 0.07 }).success
        ).toBe(true);
        expect(
          createTipoSensorSchema.safeParse({ ...payloadValido, faixa_min: 0.001 }).success
        ).toBe(false);
        expect(
          createTipoSensorSchema.safeParse({ ...payloadValido, faixa_max: 1.005 }).success
        ).toBe(false);
      });

      it("deve rejeitar faixa enviada como texto", () => {
        const resultado = createTipoSensorSchema.safeParse({
          ...payloadValido,
          faixa_min: "0",
        });

        expect(resultado.success).toBe(false);
      });
    });
  });
});
