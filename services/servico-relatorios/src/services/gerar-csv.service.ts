import { Writable } from "node:stream";
import {
  buscarLoteMedicoes,
  ChaveLote,
  FiltrosMedicoes,
} from "../repositories/medicoes.repository";
import { formatarCsv } from "../utils/formatar-csv";

export const TAMANHO_LOTE = 5000;

// Escreve o CSV do período inteiro em lotes, sem carregar tudo na memória. Não fecha a saída.
export async function escreverCsv(filtros: FiltrosMedicoes, saida: Writable): Promise<void> {
  let depoisDe: ChaveLote | null = null;
  let primeiro = true;

  for (;;) {
    const lote = await buscarLoteMedicoes(filtros, depoisDe, TAMANHO_LOTE);
    if (saida.destroyed) return; // o cliente desistiu do download

    const texto = formatarCsv(lote, primeiro);
    primeiro = false;
    if (texto && !saida.write(texto)) await esperarDrain(saida);

    if (lote.length < TAMANHO_LOTE) return;
    depoisDe = lote[lote.length - 1];
  }
}

// Espera o `drain`; se a conexão fechar antes, segue, e o laço para no `destroyed`.
function esperarDrain(saida: Writable): Promise<void> {
  return new Promise((resolve) => {
    const seguir = () => {
      saida.off("drain", seguir);
      saida.off("close", seguir);
      resolve();
    };
    saida.on("drain", seguir);
    saida.on("close", seguir);
  });
}
