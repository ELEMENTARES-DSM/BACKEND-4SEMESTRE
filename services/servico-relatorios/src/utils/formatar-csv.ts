import { LinhaMedicao } from "../repositories/medicoes.repository";

// Power BI (Obter dados › Texto/CSV) e Excel: UTF-8 com BOM, `;`, vírgula decimal e CRLF.
export const CABECALHO_CSV =
  "lido_em;estacao_codigo;estacao_nome;municipio;sensor_codigo;grandeza;unidade;valor;valor_bruto;valida";
export const BOM = String.fromCharCode(0xfeff);
const FIM_DE_LINHA = "\r\n";

const dataHora = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  dateStyle: "short",
  timeStyle: "short",
});

// O Intl do Node escreve "06/11/2026, 11:05"; o CSV usa "06/11/2026 11:05".
export function lidoEm(unixtime: string): string {
  return dataHora.format(new Date(Number(unixtime) * 1000)).replace(", ", " ");
}

// A partir do texto do pg, sem passar por number: "23.400000" → "23,4"; "24.000000" → "24".
export function decimal(texto: string): string {
  const semZeros = texto.includes(".") ? texto.replace(/\.?0+$/, "") : texto;
  return semZeros.replace(".", ",");
}

function campo(valor: string): string {
  return /[;"\r\n]/.test(valor) ? `"${valor.replaceAll('"', '""')}"` : valor;
}

export function linhaCsv(m: LinhaMedicao): string {
  return [
    lidoEm(m.unixtime),
    m.estacao_codigo,
    m.estacao_nome,
    m.municipio,
    m.sensor_codigo ?? "",
    m.grandeza,
    m.unidade,
    decimal(m.valor),
    decimal(m.valor_bruto),
    m.valida ? "Sim" : "Não",
  ].map(campo).join(";") + FIM_DE_LINHA;
}

// O primeiro trecho do arquivo leva o BOM e o cabeçalho, mesmo sem linhas.
export function formatarCsv(linhas: LinhaMedicao[], comCabecalho: boolean): string {
  return (comCabecalho ? BOM + CABECALHO_CSV + FIM_DE_LINHA : "") + linhas.map(linhaCsv).join("");
}
