import { describe, it, expect } from "@jest/globals";
import { LinhaMedicao } from "../../repositories/medicoes.repository";
import { BOM, CABECALHO_CSV, decimal, formatarCsv, lidoEm, linhaCsv } from "../../utils/formatar-csv";

const medicao = (extra: Partial<LinhaMedicao> = {}): LinhaMedicao => ({
  id: "0b6f6c1e-3c1a-4c55-9a43-2f1d6c1b9f10",
  unixtime: "1793973900",
  estacao_codigo: "EST-001",
  estacao_nome: "Centro",
  municipio: "São José dos Campos",
  sensor_codigo: "T-01",
  grandeza: "Temperatura",
  unidade: "°C",
  valor: "23.400000",
  valor_bruto: "24.900000",
  valida: true,
  ...extra,
});

describe("formatar-csv (US-31)", () => {
  describe("formatarCsv", () => {
    it("deve começar com o BOM EF BB BF quando é o primeiro trecho do arquivo", () => {
      // Dado:
      const linhas = [medicao()];

      // Quando:
      const bytes = Buffer.from(formatarCsv(linhas, true), "utf8");

      // Então:
      expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    });

    it("deve omitir o BOM e o cabeçalho quando não é o primeiro trecho do arquivo", () => {
      // Dado:
      const linhas = [medicao()];

      // Quando:
      const texto = formatarCsv(linhas, false);

      // Então:
      expect(texto).toBe(
        "06/11/2026 11:05;EST-001;Centro;São José dos Campos;T-01;Temperatura;°C;23,4;24,9;Sim\r\n",
      );
    });

    it("deve sair só com o BOM e o cabeçalho quando não há linhas", () => {
      // Dado:
      const linhas: LinhaMedicao[] = [];

      // Quando:
      const texto = formatarCsv(linhas, true);

      // Então:
      expect(texto).toBe(`${BOM}${CABECALHO_CSV}\r\n`);
    });
  });

  describe("linhaCsv", () => {
    it("deve separar com ; e terminar com CRLF quando escreve uma linha", () => {
      // Dado:
      const linha = medicao();

      // Quando:
      const texto = linhaCsv(linha);

      // Então:
      expect(texto).toBe(
        "06/11/2026 11:05;EST-001;Centro;São José dos Campos;T-01;Temperatura;°C;23,4;24,9;Sim\r\n",
      );
    });

    it("deve escrever entre aspas, com as aspas dobradas, quando o campo tem ; e aspas", () => {
      // Dado:
      const linha = medicao({ estacao_nome: 'Estação "Centro"; Sul' });

      // Quando:
      const texto = linhaCsv(linha);

      // Então:
      expect(texto.split(";").slice(0, 2)).toEqual(["06/11/2026 11:05", "EST-001"]);
      expect(texto).toContain(';"Estação ""Centro""; Sul";');
    });

    it("deve deixar o sensor_codigo vazio quando o sensor não tem código", () => {
      // Dado:
      const linha = medicao({ sensor_codigo: null });

      // Quando:
      const texto = linhaCsv(linha);

      // Então:
      expect(texto.split(";")[4]).toBe("");
    });

    it("deve escrever Não quando valida é false", () => {
      // Dado:
      const linha = medicao({ valida: false });

      // Quando:
      const texto = linhaCsv(linha);

      // Então:
      expect(texto.trimEnd().split(";").at(-1)).toBe("Não");
    });
  });

  describe("lidoEm", () => {
    it("deve escrever a hora de Brasília em dd/mm/aaaa hh:mm quando recebe o unixtime", () => {
      // Dado:
      const unixtime = "1793973900"; // 2026-11-06T14:05:00Z

      // Quando:
      const texto = lidoEm(unixtime);

      // Então:
      expect(texto).toBe("06/11/2026 11:05");
    });
  });

  describe("decimal", () => {
    it.each([
      ["23.400000", "23,4"],
      ["24.000000", "24"],
      ["24", "24"],
      ["0.000000", "0"],
      ["-0.500000", "-0,5"],
      ["100.050000", "100,05"],
    ])("deve escrever %s como %s quando converte o decimal do pg", (texto, esperado) => {
      // Dado:
      const valor = texto;

      // Quando:
      const resultado = decimal(valor);

      // Então:
      expect(resultado).toBe(esperado);
    });
  });
});
