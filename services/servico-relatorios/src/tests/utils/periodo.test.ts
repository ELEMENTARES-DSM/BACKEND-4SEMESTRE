import { describe, it, expect, jest, afterEach } from "@jest/globals";
import { diaEmBrasilia, periodo } from "../../utils/periodo";

describe("US-31 · filtros · período em Brasília", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("deve começar às 03:00Z e durar 86.400 s quando início e fim são o mesmo dia", () => {
    // Dado
    const dia = "2026-11-06";

    // Quando
    const { de, ate } = periodo(dia, dia);

    // Então
    expect(new Date(de * 1000).toISOString()).toBe("2026-11-06T03:00:00.000Z");
    expect(ate - de).toBe(86400);
  });

  it("deve incluir o dia do fim inteiro quando o período tem dois dias", () => {
    // Dado
    const inicio = "2026-11-05";
    const fim = "2026-11-06";

    // Quando
    const { ate } = periodo(inicio, fim);

    // Então
    expect(new Date(ate * 1000).toISOString()).toBe("2026-11-07T03:00:00.000Z");
  });

  it("deve devolver o dia anterior quando ainda não é meia-noite em Brasília", () => {
    // Dado
    jest.useFakeTimers({ now: new Date("2026-11-07T02:59:00Z") });

    // Quando
    const hoje = diaEmBrasilia();
    const ontem = diaEmBrasilia(1);

    // Então
    expect(hoje).toBe("2026-11-06");
    expect(ontem).toBe("2026-11-05");
  });
});
