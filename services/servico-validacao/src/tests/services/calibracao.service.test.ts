import { describe, it, expect } from "@jest/globals";
import {
  calibrarValor,
  formatarEscala6,
  paraBigIntEscala6,
  valoresBrutosIguais,
} from "../../services/calibracao.service";

describe("calibracao.service", () => {
  describe("paraBigIntEscala6", () => {
    it("converte inteiros, decimais positivos e negativos para escala 10^6", () => {
      expect(paraBigIntEscala6(25)).toBe(25_000_000n);
      expect(paraBigIntEscala6(25.4)).toBe(25_400_000n);
      expect(paraBigIntEscala6("1.123456")).toBe(1_123_456n);
      expect(paraBigIntEscala6("-0.5")).toBe(-500_000n);
      expect(paraBigIntEscala6("-0.000000")).toBe(0n);
    });

    it("suporta notação científica e arredonda acima de 6 casas com HALF_UP", () => {
      expect(paraBigIntEscala6(1e-6)).toBe(1n);
      expect(paraBigIntEscala6("1.0000005")).toBe(1_000_001n);
      expect(paraBigIntEscala6("-1.0000005")).toBe(-1_000_001n);
    });

    it("lança erro para entradas inválidas", () => {
      expect(() => paraBigIntEscala6(Number.NaN)).toThrow();
      expect(() => paraBigIntEscala6(Number.POSITIVE_INFINITY)).toThrow();
      expect(() => paraBigIntEscala6("")).toThrow();
      expect(() => paraBigIntEscala6("abc")).toThrow();
    });
  });

  describe("calibrarValor", () => {
    it("mantém o valor com 2 casas quando fator = 1 e ganho = 0", () => {
      expect(calibrarValor(25.4, "1.000000", "0.000000")).toBe("25.40");
      expect(calibrarValor(0, 1, 0)).toBe("0.00");
    });

    it("aplica a fórmula (bruto * fator) + ganho em decimal exato sem erro IEEE 754", () => {
      // Em ponto flutuante: 0.1 + 0.2 = 0.30000000000000004
      expect(calibrarValor(0.1, 1, 0.2)).toBe("0.30");
      // Em ponto flutuante: 1.005 * 1 = 1.005, mas (1.005).toFixed(2) em JS dá "1.00" por imprecisão binária!
      expect(calibrarValor(1.005, 1, 0)).toBe("1.01");
      expect(calibrarValor(35.85, "1.005000", "-0.025000")).toBe("36.00");
    });

    it("arredonda para 2 casas no modo HALF_UP (afastando-se de zero nos empates)", () => {
      // Positivos: empate na 3ª casa (0.005) sobe para longe de zero
      expect(calibrarValor(2.345, 1, 0)).toBe("2.35");
      expect(calibrarValor(2.344, 1, 0)).toBe("2.34");
      expect(calibrarValor(2.3451, 1, 0)).toBe("2.35");

      // Negativos: empate na 3ª casa (-0.005) afasta-se de zero (-2.35)
      expect(calibrarValor(-2.345, 1, 0)).toBe("-2.35");
      expect(calibrarValor(-2.344, 1, 0)).toBe("-2.34");
      expect(calibrarValor(-0.005, 1, 0)).toBe("-0.01");
      expect(calibrarValor(-0.004, 1, 0)).toBe("0.00");
    });

    it("calcula corretamente com fatores e ganhos fracionários de 6 casas", () => {
      // 100 * 0.987654 + (-1.234567) = 98.7654 - 1.234567 = 97.530833 -> 97.53
      expect(calibrarValor(100, "0.987654", "-1.234567")).toBe("97.53");
      // 10 * 0.123450 + 0.000500 = 1.2345 + 0.0005 = 1.235 -> 1.24
      expect(calibrarValor(10, "0.123450", "0.000500")).toBe("1.24");
    });
  });

  describe("formatarEscala6 e valoresBrutosIguais", () => {
    it("formata BigInt em escala 6 com 6 casas decimais", () => {
      expect(formatarEscala6(25_400_000n)).toBe("25.400000");
      expect(formatarEscala6(-500_000n)).toBe("-0.500000");
      expect(formatarEscala6(0n)).toBe("0.000000");
    });

    it("compara valores brutos em diferentes representações numéricas/string", () => {
      expect(valoresBrutosIguais(25.4, "25.400000")).toBe(true);
      expect(valoresBrutosIguais(-0, "0.000000")).toBe(true);
      expect(valoresBrutosIguais(25.4, "25.400001")).toBe(false);
    });
  });
});
