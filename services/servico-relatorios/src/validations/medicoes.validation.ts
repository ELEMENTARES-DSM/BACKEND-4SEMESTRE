import { z } from "zod";
import { diaEmBrasilia } from "../utils/periodo";

// A 42.04 troca este limite pelo período de cada perfil.
export const LIMITE_DIAS_PERIODO = 31;
export const POR_PAGINA_MAXIMO = 5000;

// AAAA-MM-DD de um dia que existe (Date.parse aceita 2026-02-30 e devolve 02/03).
function dataValida(texto: string): boolean {
  const ms = Date.parse(`${texto}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(texto) && !Number.isNaN(ms)
    && new Date(ms).toISOString().startsWith(texto);
}

const data = (campo: string, padrao: () => string) => {
  const mensagem = `Data de ${campo} inválida: use AAAA-MM-DD.`;
  return z.string(mensagem).refine(dataValida, mensagem).default(padrao);
};

// "EST-001, EST-002" → ["EST-001", "EST-002"]; ausente ou vazio → null (sem filtro).
const lista = (mensagem: string) =>
  z.string(mensagem).optional().transform((texto) => {
    const itens = (texto ?? "").split(",").map((item) => item.trim()).filter(Boolean);
    return itens.length > 0 ? itens : null;
  });

const inteiro = (mensagem: string, maximo: number, padrao: number) =>
  z.coerce.number(mensagem).int(mensagem).min(1, mensagem).max(maximo, mensagem).default(padrao);

const dias = (inicio: string, fim: string) => (Date.parse(fim) - Date.parse(inicio)) / 86400_000 + 1;

export const filtrosMedicoesSchema = z
  .strictObject({
    inicio: data("início", () => diaEmBrasilia(1)),
    fim: data("fim", () => diaEmBrasilia()),
    estacao: lista("Estação inválida: use códigos separados por vírgula."),
    grandeza: lista("Grandeza inválida: use nomes separados por vírgula."),
    municipio: z.string("Município inválido.").trim().optional().transform((texto) => texto || undefined),
    formato: z.enum(["json", "csv"], "Formato inválido: use json ou csv.").default("json"),
    pagina: inteiro("Página inválida: use um número inteiro a partir de 1.", Number.MAX_SAFE_INTEGER, 1),
    porPagina: inteiro(
      `porPagina inválido: use um número inteiro de 1 a ${POR_PAGINA_MAXIMO}.`,
      POR_PAGINA_MAXIMO,
      500,
    ),
  })
  .refine((f) => f.fim >= f.inicio, { message: "Período inválido: o fim é antes do início.", path: ["fim"] })
  .refine((f) => f.fim < f.inicio || dias(f.inicio, f.fim) <= LIMITE_DIAS_PERIODO, {
    message: `Período inválido: o máximo é ${LIMITE_DIAS_PERIODO} dias.`,
    path: ["fim"],
  });

export type FiltrosMedicoesDTO = z.infer<typeof filtrosMedicoesSchema>;

export type ResultadoValidacao =
  | { sucesso: true; filtros: FiltrosMedicoesDTO }
  | { sucesso: false; erro: string };

export function validarFiltrosMedicoes(query: unknown): ResultadoValidacao {
  const resultado = filtrosMedicoesSchema.safeParse(query ?? {});
  if (resultado.success) return { sucesso: true, filtros: resultado.data };

  const problema = resultado.error.issues[0];
  const erro = problema.code === "unrecognized_keys"
    ? `Parâmetro desconhecido: ${problema.keys.join(", ")}.`
    : problema.message;
  return { sucesso: false, erro };
}
