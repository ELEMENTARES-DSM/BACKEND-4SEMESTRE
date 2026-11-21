import { loginSchema } from "../../validations/auth.validation";

describe("auth.validation", () => {
  it("deve aceitar e-mail válido e senha preenchida", () => {
    const result = loginSchema.safeParse({
      email: "usuario@elementares.gov.br",
      senha: "segredo123",
    });

    expect(result.success).toBe(true);
  });

  it("deve rejeitar e-mail inválido", () => {
    const result = loginSchema.safeParse({
      email: "nao-e-email",
      senha: "segredo123",
    });

    expect(result.success).toBe(false);
  });

  it("deve rejeitar senha vazia", () => {
    const result = loginSchema.safeParse({
      email: "usuario@elementares.gov.br",
      senha: "",
    });

    expect(result.success).toBe(false);
  });
});
