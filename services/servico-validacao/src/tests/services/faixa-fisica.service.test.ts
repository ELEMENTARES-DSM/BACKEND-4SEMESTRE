import { describe, it, expect } from "@jest/globals";
import {
  buscarFaixaFisica,
  dentroDaFaixa,
  descreverFaixa,
  FAIXAS_FISICAS,
} from "../../services/faixa-fisica.service";

describe("faixa-fisica.service (US-19)", () => {
  describe("buscarFaixaFisica", () => {
    it.each([
      ["Temperatura", "-50", "60"],
      ["Umidade Relativa", "0", "100"],
      ["PM2.5", "0", "1000"],
      ["PM10", "0", "1000"],
      ["Velocidade do Vento", "0", "400"],
      ["Direção do Vento", "0", "360"],
      ["Precipitação", "0", "500"],
      ["Pressão Atmosférica", "600", "1100"],
    ])("deve retornar a faixa de %s quando o tipo está cadastrado", (tipo, minimo, maximo) => {
      expect(buscarFaixaFisica(tipo)).toMatchObject({ minimo, maximo });
    });

    it("deve retornar indefinido quando o tipo não tem faixa cadastrada", () => {
      expect(buscarFaixaFisica("Radiação Solar")).toBeUndefined();
      expect(buscarFaixaFisica(undefined)).toBeUndefined();
    });
  });

  describe("dentroDaFaixa", () => {
    const umidade = FAIXAS_FISICAS["Umidade Relativa"];

    it("deve aceitar quando a umidade está exatamente no limite máximo de 100,00", () => {
      // Dado: a faixa física da umidade relativa vai de 0 a 100.
      // Quando: o valor está no limite máximo.
      const resultado = dentroDaFaixa("100.00", umidade);

      // Então: o valor é aceito, pois os limites são inclusivos.
      expect(resultado).toBe(true);
    });

    it("deve rejeitar quando a umidade excede o limite máximo em 0,10", () => {
      // Dado: a faixa física da umidade relativa vai de 0 a 100.
      // Quando: o valor está logo acima do limite máximo.
      const resultado = dentroDaFaixa("100.10", umidade);

      // Então: o valor é rejeitado.
      expect(resultado).toBe(false);
    });

    it("deve aceitar quando a umidade está exatamente no limite mínimo de 0,00", () => {
      expect(dentroDaFaixa("0.00", umidade)).toBe(true);
    });

    it("deve rejeitar quando a umidade fica abaixo do limite mínimo em 0,10", () => {
      expect(dentroDaFaixa("-0.10", umidade)).toBe(false);
    });

    it("deve comparar decimais com precisão quando o valor excede o limite em 0,01", () => {
      expect(dentroDaFaixa("100.01", umidade)).toBe(false);
    });

    it("deve usar a faixa da grandeza quando o mesmo valor é avaliado em sensores diferentes", () => {
      expect(dentroDaFaixa("70.00", FAIXAS_FISICAS.Temperatura)).toBe(false);
      expect(dentroDaFaixa("70.00", FAIXAS_FISICAS["Velocidade do Vento"])).toBe(true);
    });

    it("deve aceitar temperatura no limite negativo e rejeitar quando fica abaixo dele", () => {
      expect(dentroDaFaixa("-50.00", FAIXAS_FISICAS.Temperatura)).toBe(true);
      expect(dentroDaFaixa("-50.01", FAIXAS_FISICAS.Temperatura)).toBe(false);
    });
  });

  describe("descreverFaixa", () => {
    it("deve incluir limites e unidade quando descreve uma faixa", () => {
      expect(descreverFaixa(FAIXAS_FISICAS["Umidade Relativa"])).toBe("0 a 100 %");
      expect(descreverFaixa(FAIXAS_FISICAS.Temperatura)).toBe("-50 a 60 °C");
    });
  });
});
