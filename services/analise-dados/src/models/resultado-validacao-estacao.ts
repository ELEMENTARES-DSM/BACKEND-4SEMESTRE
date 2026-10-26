export type ResultadoValidacaoEstacao =
  | { valido: true; estacaoId: string }
  | { valido: false; motivo: "TOPICO_INVALIDO" | "Estação desconhecida" | "Estação inativa" };
