import { describe, it, expect, jest, afterEach } from "@jest/globals";
import { validarFiltrosMedicoes } from "../../validations/medicoes.validation";

describe("medicoes.validation (US-31)", () => {
  describe("validarFiltrosMedicoes", () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it("deve recusar quando o fim é antes do início", () => {
      // Dado:
      const query = { inicio: "2026-11-06", fim: "2026-11-05" };

      // Quando:
      const resultado = validarFiltrosMedicoes(query);

      // Então:
      expect(resultado).toEqual({ sucesso: false, erro: "Período inválido: o fim é antes do início." });
    });

    it("deve aceitar quando o período tem exatamente 31 dias", () => {
      // Dado:
      const query = { inicio: "2026-11-01", fim: "2026-12-01" };

      // Quando:
      const resultado = validarFiltrosMedicoes(query);

      // Então:
      expect(resultado.sucesso).toBe(true);
    });

    it("deve recusar quando o período tem 32 dias", () => {
      // Dado:
      const query = { inicio: "2026-11-01", fim: "2026-12-02" };

      // Quando:
      const resultado = validarFiltrosMedicoes(query);

      // Então:
      expect(resultado).toEqual({ sucesso: false, erro: "Período inválido: o máximo é 31 dias." });
    });

    it("deve recusar quando a data de início não existe no calendário", () => {
      // Dado:
      const query = { inicio: "2026-02-30", fim: "2026-03-01" };

      // Quando:
      const resultado = validarFiltrosMedicoes(query);

      // Então:
      expect(resultado).toEqual({ sucesso: false, erro: "Data de início inválida: use AAAA-MM-DD." });
    });

    it("deve recusar quando a data de fim não existe no calendário", () => {
      // Dado:
      const query = { inicio: "2026-02-01", fim: "2026-02-30" };

      // Quando:
      const resultado = validarFiltrosMedicoes(query);

      // Então:
      expect(resultado).toEqual({ sucesso: false, erro: "Data de fim inválida: use AAAA-MM-DD." });
    });

    it("deve recusar quando a data não está no formato AAAA-MM-DD", () => {
      // Dado:
      const query = { inicio: "06/11/2026" };

      // Quando:
      const resultado = validarFiltrosMedicoes(query);

      // Então:
      expect(resultado).toEqual({ sucesso: false, erro: "Data de início inválida: use AAAA-MM-DD." });
    });

    it("deve aceitar quando pagina está exatamente no limite inferior (1)", () => {
      // Dado:
      const query = { inicio: "2026-11-06", fim: "2026-11-06", pagina: "1" };

      // Quando:
      const resultado = validarFiltrosMedicoes(query);

      // Então:
      expect(resultado).toMatchObject({ sucesso: true, filtros: { pagina: 1 } });
    });

    it("deve recusar quando pagina é 0", () => {
      // Dado:
      const query = { inicio: "2026-11-06", fim: "2026-11-06", pagina: "0" };

      // Quando:
      const resultado = validarFiltrosMedicoes(query);

      // Então:
      expect(resultado).toEqual({
        sucesso: false,
        erro: "Página inválida: use um número inteiro a partir de 1.",
      });
    });

    it("deve aceitar quando porPagina está exatamente no limite inferior (1)", () => {
      // Dado:
      const query = { inicio: "2026-11-06", fim: "2026-11-06", porPagina: "1" };

      // Quando:
      const resultado = validarFiltrosMedicoes(query);

      // Então:
      expect(resultado).toMatchObject({ sucesso: true, filtros: { porPagina: 1 } });
    });

    it("deve recusar quando porPagina é 0", () => {
      // Dado:
      const query = { inicio: "2026-11-06", fim: "2026-11-06", porPagina: "0" };

      // Quando:
      const resultado = validarFiltrosMedicoes(query);

      // Então:
      expect(resultado).toEqual({
        sucesso: false,
        erro: "porPagina inválido: use um número inteiro de 1 a 5000.",
      });
    });

    it("deve aceitar quando porPagina está exatamente no limite superior (5000)", () => {
      // Dado:
      const query = { inicio: "2026-11-06", fim: "2026-11-06", porPagina: "5000" };

      // Quando:
      const resultado = validarFiltrosMedicoes(query);

      // Então:
      expect(resultado).toMatchObject({ sucesso: true, filtros: { porPagina: 5000 } });
    });

    it("deve recusar quando porPagina passa do limite superior (5001)", () => {
      // Dado:
      const query = { inicio: "2026-11-06", fim: "2026-11-06", porPagina: "5001" };

      // Quando:
      const resultado = validarFiltrosMedicoes(query);

      // Então:
      expect(resultado).toEqual({
        sucesso: false,
        erro: "porPagina inválido: use um número inteiro de 1 a 5000.",
      });
    });

    it("deve recusar quando o formato não é json nem csv", () => {
      // Dado:
      const query = { inicio: "2026-11-06", fim: "2026-11-06", formato: "xlsx" };

      // Quando:
      const resultado = validarFiltrosMedicoes(query);

      // Então:
      expect(resultado).toEqual({ sucesso: false, erro: "Formato inválido: use json ou csv." });
    });

    it("deve recusar quando vem um parâmetro desconhecido", () => {
      // Dado:
      const query = { inicio: "2026-11-06", fim: "2026-11-06", sensor: "T-01" };

      // Quando:
      const resultado = validarFiltrosMedicoes(query);

      // Então:
      expect(resultado).toEqual({ sucesso: false, erro: "Parâmetro desconhecido: sensor." });
    });

    it("deve usar ontem e hoje em Brasília, json e a página 1 de 500 quando não vem nenhum filtro", () => {
      // Dado:
      jest.useFakeTimers({ now: new Date("2026-11-07T02:00:00Z") }); // 06/11 23:00 em Brasília

      // Quando:
      const resultado = validarFiltrosMedicoes(undefined);

      // Então:
      expect(resultado).toEqual({
        sucesso: true,
        filtros: {
          inicio: "2026-11-05",
          fim: "2026-11-06",
          estacao: null,
          grandeza: null,
          municipio: undefined,
          formato: "json",
          pagina: 1,
          porPagina: 500,
        },
      });
    });

    it("deve separar os códigos quando vêm vários separados por vírgula", () => {
      // Dado:
      const query = {
        inicio: "2026-11-06",
        fim: "2026-11-06",
        estacao: "EST-001, EST-002",
        grandeza: "PM2.5",
        municipio: "  São José dos Campos  ",
      };

      // Quando:
      const resultado = validarFiltrosMedicoes(query);

      // Então:
      expect(resultado).toMatchObject({
        sucesso: true,
        filtros: {
          estacao: ["EST-001", "EST-002"],
          grandeza: ["PM2.5"],
          municipio: "São José dos Campos",
        },
      });
    });
  });
});
