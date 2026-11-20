import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { describe, it, expect, jest } from "@jest/globals";
import {
  buscarLoteMedicoes,
  FiltrosMedicoes,
  LinhaMedicao,
} from "../../repositories/medicoes.repository";
import { escreverCsv, TAMANHO_LOTE } from "../../services/gerar-csv.service";
import { BOM, CABECALHO_CSV } from "../../utils/formatar-csv";

jest.mock("../../repositories/medicoes.repository");

const buscarLote = jest.mocked(buscarLoteMedicoes);

const filtrosPadrao: FiltrosMedicoes = {
  municipio: "São José dos Campos",
  de: 1793934000,
  ate: 1794020400,
  estacoes: null,
  grandezas: null,
};

const linha = (indice: number): LinhaMedicao => ({
  id: `00000000-0000-4000-8000-${String(indice).padStart(12, "0")}`,
  unixtime: String(1793973900 + indice),
  estacao_codigo: "EST-001",
  estacao_nome: "Centro",
  municipio: "São José dos Campos",
  sensor_codigo: "T-01",
  grandeza: "Temperatura",
  unidade: "°C",
  valor: "23.400000",
  valor_bruto: "24.900000",
  valida: true,
});

function criarSaidaFalsa(comBackpressure = false) {
  const emissor = new EventEmitter();
  const escritos: string[] = [];
  const saida = Object.assign(emissor, {
    destroyed: false,
    write: jest.fn((texto: string) => {
      escritos.push(texto);
      return !comBackpressure;
    }),
  });
  return { saida: saida as unknown as Writable & { destroyed: boolean; write: jest.Mock }, escritos };
}

describe("gerar-csv.service (US-31)", () => {
  describe("escreverCsv", () => {
    it("deve escrever somente o BOM e o cabeçalho quando o primeiro lote vem vazio", async () => {
      // Dado:
      const { saida, escritos } = criarSaidaFalsa();
      buscarLote.mockResolvedValueOnce([]);

      // Quando:
      await escreverCsv(filtrosPadrao, saida);

      // Então:
      expect(buscarLote).toHaveBeenCalledTimes(1);
      expect(buscarLote).toHaveBeenCalledWith(filtrosPadrao, null, TAMANHO_LOTE);
      expect(escritos).toEqual([`${BOM}${CABECALHO_CSV}\r\n`]);
    });

    it("deve buscar o próximo lote usando o último item quando o lote vem completo", async () => {
      // Dado:
      const { saida, escritos } = criarSaidaFalsa();
      const primeiroLote = Array.from({ length: TAMANHO_LOTE }, (_, i) => linha(i + 1));
      const segundoLote = [linha(TAMANHO_LOTE + 1)];
      buscarLote.mockResolvedValueOnce(primeiroLote).mockResolvedValueOnce(segundoLote);

      // Quando:
      await escreverCsv(filtrosPadrao, saida);

      // Então:
      expect(buscarLote).toHaveBeenCalledTimes(2);
      expect(buscarLote).toHaveBeenNthCalledWith(1, filtrosPadrao, null, TAMANHO_LOTE);
      expect(buscarLote).toHaveBeenNthCalledWith(
        2,
        filtrosPadrao,
        primeiroLote[TAMANHO_LOTE - 1],
        TAMANHO_LOTE,
      );
      expect(escritos).toHaveLength(2);
      expect(escritos[0].startsWith(`${BOM}${CABECALHO_CSV}\r\n`)).toBe(true);
      expect(escritos[1].startsWith(BOM)).toBe(false);
    });

    it("deve esperar o evento drain quando write retorna false", async () => {
      // Dado:
      const { saida } = criarSaidaFalsa(true);
      const primeiroLote = Array.from({ length: TAMANHO_LOTE }, (_, i) => linha(i + 1));
      buscarLote.mockResolvedValueOnce(primeiroLote).mockResolvedValueOnce([]);

      // Quando:
      const promessa = escreverCsv(filtrosPadrao, saida);
      await Promise.resolve();
      const chamadasAntesDoDrain = buscarLote.mock.calls.length;
      saida.emit("drain");
      await promessa;

      // Então:
      expect(chamadasAntesDoDrain).toBe(1);
      expect(buscarLote).toHaveBeenCalledTimes(2);
      expect(saida.write).toHaveBeenCalledTimes(1);
    });

    it("deve encerrar sem escrever quando a saída já está destruída após a consulta", async () => {
      // Dado:
      const { saida, escritos } = criarSaidaFalsa();
      buscarLote.mockImplementationOnce(async () => {
        saida.destroyed = true;
        return [linha(1)];
      });

      // Quando:
      await escreverCsv(filtrosPadrao, saida);

      // Então:
      expect(escritos).toEqual([]);
      expect(saida.write).not.toHaveBeenCalled();
    });

    it("deve interromper o laço quando a conexão fecha durante a espera do drain", async () => {
      // Dado:
      const { saida } = criarSaidaFalsa(true);
      const primeiroLote = Array.from({ length: TAMANHO_LOTE }, (_, i) => linha(i + 1));
      buscarLote.mockResolvedValueOnce(primeiroLote).mockResolvedValueOnce([linha(TAMANHO_LOTE + 1)]);

      // Quando:
      const promessa = escreverCsv(filtrosPadrao, saida);
      await Promise.resolve();
      saida.destroyed = true;
      saida.emit("close");
      await promessa;

      // Então:
      expect(buscarLote).toHaveBeenCalledTimes(2);
      expect(saida.write).toHaveBeenCalledTimes(1);
    });
  });
});
