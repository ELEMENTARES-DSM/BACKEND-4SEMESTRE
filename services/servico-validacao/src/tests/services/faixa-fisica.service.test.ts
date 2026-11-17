import { describe, it, expect } from "@jest/globals";
import {
  dentroDaFaixa,
  descreverFaixa,
  faixaDoSensor,
} from "../../services/faixa-fisica.service";
import { CATALOGO, faixaDoCatalogo } from "../helpers/catalogo";

// A faixa vem da linha do catálogo (tipos_sensor) que acompanha o sensor.
const faixaDe = (tipo: string) => faixaDoSensor(faixaDoCatalogo(tipo));

describe("faixa-fisica.service (US-19 e US-39)", () => {
  const umidade = faixaDe("Umidade Relativa");

  describe("faixaDoSensor", () => {
    it.each([
      ["Temperatura", "-50.00", "60.00", "°C"],
      ["Umidade Relativa", "0.00", "100.00", "%"],
      ["PM2.5", "0.00", "1000.00", "µg/m³"],
      ["PM10", "0.00", "1000.00", "µg/m³"],
      ["Velocidade do Vento", "0.00", "400.00", "km/h"],
      ["Direção do Vento", "0.00", "360.00", "°"],
      ["Precipitação", "0.00", "500.00", "mm"],
      ["Pressão Atmosférica", "600.00", "1100.00", "hPa"],
    ])("deve montar a faixa de %s a partir da linha do catálogo (%s a %s %s)", (tipo, minimo, maximo, unidade) => {
      // Dado
      const linha = faixaDoCatalogo(tipo);

      // Quando
      const faixa = faixaDoSensor(linha);

      // Então
      expect(faixa).toEqual({ minimo, maximo, unidade });
    });

    it("deve usar a faixa que o sensor traz, sem consultar nenhuma tabela fixa", () => {
      // Dado: grandeza que não existe na carga inicial, cadastrada pelo Administrador
      const nebulosidade = { faixa_min: "0.00", faixa_max: "8.00", unidade: "oitavos" };

      // Quando
      const faixa = faixaDoSensor(nebulosidade);

      // Então
      expect(faixa).toEqual({ minimo: "0.00", maximo: "8.00", unidade: "oitavos" });
      expect(dentroDaFaixa("8.00", faixa)).toBe(true);
      expect(dentroDaFaixa("8.01", faixa)).toBe(false);
    });

    it("deve cobrir as 8 grandezas da carga inicial no catálogo de teste", () => {
      expect(Object.keys(CATALOGO)).toHaveLength(8);
    });
  });

  describe("dentroDaFaixa", () => {
    it("deve aceitar os limites: umidade 0,00 e 100,00 são válidas", () => {
      expect(dentroDaFaixa("0.00", umidade)).toBe(true);
      expect(dentroDaFaixa("100.00", umidade)).toBe(true);
    });

    it("deve rejeitar logo depois dos limites: umidade 100,01 e -0,01 ficam fora", () => {
      expect(dentroDaFaixa("100.01", umidade)).toBe(false);
      expect(dentroDaFaixa("-0.01", umidade)).toBe(false);
    });

    it("deve rejeitar 100,10 e -0,10 na umidade", () => {
      expect(dentroDaFaixa("100.10", umidade)).toBe(false);
      expect(dentroDaFaixa("-0.10", umidade)).toBe(false);
    });

    it("deve tratar o mesmo 70,00 como inválido para temperatura e válido para vento", () => {
      expect(dentroDaFaixa("70.00", faixaDe("Temperatura"))).toBe(false);
      expect(dentroDaFaixa("70.00", faixaDe("Velocidade do Vento"))).toBe(true);
    });

    it("deve aceitar temperatura negativa até -50,00 e rejeitar -50,01", () => {
      expect(dentroDaFaixa("-50.00", faixaDe("Temperatura"))).toBe(true);
      expect(dentroDaFaixa("-50.01", faixaDe("Temperatura"))).toBe(false);
    });

    it("deve aceitar 360,00 e rejeitar 360,01 na direção do vento (Cenário 4 da US-39)", () => {
      expect(dentroDaFaixa("360.00", faixaDe("Direção do Vento"))).toBe(true);
      expect(dentroDaFaixa("360.01", faixaDe("Direção do Vento"))).toBe(false);
    });

    it("deve aceitar 600,00 e rejeitar 599,99 na pressão atmosférica (faixa que não começa em zero)", () => {
      expect(dentroDaFaixa("600.00", faixaDe("Pressão Atmosférica"))).toBe(true);
      expect(dentroDaFaixa("599.99", faixaDe("Pressão Atmosférica"))).toBe(false);
    });

    it("deve seguir a faixa alterada no catálogo: o mesmo 80,00 passa de válido para inválido", () => {
      // Dado: o Administrador reduziu a faixa máxima da umidade de 100 para 75
      const faixaAntiga = faixaDoSensor({ faixa_min: "0.00", faixa_max: "100.00", unidade: "%" });
      const faixaNova = faixaDoSensor({ faixa_min: "0.00", faixa_max: "75.00", unidade: "%" });

      // Quando / Então
      expect(dentroDaFaixa("80.00", faixaAntiga)).toBe(true);
      expect(dentroDaFaixa("80.00", faixaNova)).toBe(false);
    });
  });

  describe("descreverFaixa", () => {
    it("deve descrever a faixa esperada para o log, com as casas do catálogo", () => {
      expect(descreverFaixa(umidade)).toBe("0.00 a 100.00 %");
      expect(descreverFaixa(faixaDe("Temperatura"))).toBe("-50.00 a 60.00 °C");
    });
  });
});
