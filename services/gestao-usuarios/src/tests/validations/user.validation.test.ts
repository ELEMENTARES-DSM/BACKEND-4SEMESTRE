import { cadastroMunicipeSchema } from "../../validations/user.validation";

describe("cadastroMunicipeSchema", () => {
  const dadosValidos = {
    nome: "Ana da Silva",
    email: "ana.silva@exemplo.com",
    senha: "SenhaForte@2026",
    municipio: "São José dos Campos",
    aceite_privacidade: true,
  };

  it("aceita payload completo e válido", () => {
    const parseado = cadastroMunicipeSchema.parse(dadosValidos);
    expect(parseado.email).toBe("ana.silva@exemplo.com");
    expect(parseado.aceite_privacidade).toBe(true);
  });

  it("aceita cadastro sem município informado", () => {
    const { municipio: _, ...semMunicipio } = dadosValidos;
    const parseado = cadastroMunicipeSchema.parse(semMunicipio);
    expect(parseado.municipio).toBeUndefined();
  });

  it("rejeita quando aceite_privacidade não é true", () => {
    const semAceite = { ...dadosValidos, aceite_privacidade: false };
    const resultado = cadastroMunicipeSchema.safeParse(semAceite);
    expect(resultado.success).toBe(false);
  });

  it("rejeita quando aceite_privacidade está ausente", () => {
    const { aceite_privacidade: _, ...semAceite } = dadosValidos;
    const resultado = cadastroMunicipeSchema.safeParse(semAceite);
    expect(resultado.success).toBe(false);
  });

  describe("validação de senha forte (US-01 / RNF-12)", () => {
    it("rejeita senha com menos de 8 caracteres", () => {
      const res = cadastroMunicipeSchema.safeParse({
        ...dadosValidos,
        senha: "Ab1!xyz",
      });
      expect(res.success).toBe(false);
    });

    it("rejeita senha sem letra maiúscula", () => {
      const res = cadastroMunicipeSchema.safeParse({
        ...dadosValidos,
        senha: "senhaforte@2026",
      });
      expect(res.success).toBe(false);
    });

    it("rejeita senha sem letra minúscula", () => {
      const res = cadastroMunicipeSchema.safeParse({
        ...dadosValidos,
        senha: "SENHAFORTE@2026",
      });
      expect(res.success).toBe(false);
    });

    it("rejeita senha sem dígito numérico", () => {
      const res = cadastroMunicipeSchema.safeParse({
        ...dadosValidos,
        senha: "SenhaForteSemNumero@",
      });
      expect(res.success).toBe(false);
    });

    it("rejeita senha sem caractere especial", () => {
      const res = cadastroMunicipeSchema.safeParse({
        ...dadosValidos,
        senha: "SenhaForte2026",
      });
      expect(res.success).toBe(false);
    });
  });
});
