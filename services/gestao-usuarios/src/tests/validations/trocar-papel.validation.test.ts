import { trocarPapelSchema } from "../../validations/user.validation";

describe("trocarPapelSchema", () => {
  it("valida com sucesso payload com papel_id válido", () => {
    const valid = trocarPapelSchema.safeParse({
      papel_id: "11111111-2222-3333-4444-555555555555",
    });
    expect(valid.success).toBe(true);
  });

  it("valida com sucesso payload com papel_id e município", () => {
    const valid = trocarPapelSchema.safeParse({
      papel_id: "11111111-2222-3333-4444-555555555555",
      municipio: "São José dos Campos",
    });
    expect(valid.success).toBe(true);
  });

  it("rejeita papel_id que não seja UUID", () => {
    const invalid = trocarPapelSchema.safeParse({
      papel_id: "nao-eh-uuid",
    });
    expect(invalid.success).toBe(false);
  });

  it("rejeita payload sem papel_id", () => {
    const invalid = trocarPapelSchema.safeParse({});
    expect(invalid.success).toBe(false);
  });

  it("rejeita município maior que 100 caracteres", () => {
    const invalid = trocarPapelSchema.safeParse({
      papel_id: "11111111-2222-3333-4444-555555555555",
      municipio: "A".repeat(101),
    });
    expect(invalid.success).toBe(false);
  });
});
