import { describe, it, expect } from "@jest/globals";
import {
  buscarFaixaFisica,
  dentroDaFaixa,
  descreverFaixa,
  FAIXAS_FISICAS,
} from "../../services/faixa-fisica.service";

describe("faixa-fisica.service (US-19)", () => {
  const umidade = FAIXAS_FISICAS["Umidade Relativa"];

  it.each([
    ["Temperatura", "-50", "60"],
    ["Umidade Relativa", "0", "100"],
    ["PM2.5", "0", "1000"],
    ["PM10", "0", "1000"],
    ["Velocidade do Vento", "0", "400"],
    ["Direção do Vento", "0", "360"],
    ["Precipitação", "0", "500"],
    ["Pressão Atmosférica", "600", "1100"],
  ])("%s vai de %s a %s", (tipo, minimo, maximo) => {
    expect(buscarFaixaFisica(tipo)).toMatchObject({ minimo, maximo });
  });

  it("tipo sem faixa cadastrada não tem conferência", () => {
    expect(buscarFaixaFisica("Radiação Solar")).toBeUndefined();
    expect(buscarFaixaFisica(undefined)).toBeUndefined();
  });

  it("limites são inclusivos: umidade 0,00 e 100,00 são válidas", () => {
    expect(dentroDaFaixa("0.00", umidade)).toBe(true);
    expect(dentroDaFaixa("100.00", umidade)).toBe(true);
  });

  it("umidade 100,10 e -0,10 ficam fora da faixa", () => {
    expect(dentroDaFaixa("100.10", umidade)).toBe(false);
    expect(dentroDaFaixa("-0.10", umidade)).toBe(false);
  });

  it("compara em decimal exato: 100,01 já está fora", () => {
    expect(dentroDaFaixa("100.01", umidade)).toBe(false);
  });

  it("o mesmo 70,00 é inválido para temperatura e válido para vento", () => {
    expect(dentroDaFaixa("70.00", FAIXAS_FISICAS.Temperatura)).toBe(false);
    expect(dentroDaFaixa("70.00", FAIXAS_FISICAS["Velocidade do Vento"])).toBe(true);
  });

  it("temperatura aceita negativos até -50", () => {
    expect(dentroDaFaixa("-50.00", FAIXAS_FISICAS.Temperatura)).toBe(true);
    expect(dentroDaFaixa("-50.01", FAIXAS_FISICAS.Temperatura)).toBe(false);
  });

  it("descreve a faixa esperada para o log", () => {
    expect(descreverFaixa(umidade)).toBe("0 a 100 %");
    expect(descreverFaixa(FAIXAS_FISICAS.Temperatura)).toBe("-50 a 60 °C");
  });
});
