// Erros de rede do Node ao abrir ou usar a conexão com o PostgreSQL.
const CODIGOS_REDE = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
  "EPIPE",
]);

// SQLSTATE 57P01 a 57P03: servidor desligando, reiniciando ou ainda não aceitando conexões.
const CODIGOS_SERVIDOR_INDISPONIVEL = new Set(["57P01", "57P02", "57P03"]);

const MENSAGENS_CONEXAO = [
  /connection terminated/i,
  /timeout exceeded when trying to connect/i,
  /connection timeout/i,
];

/**
 * US-20: distingue banco fora do ar (erro de conexão ou tempo esgotado) de erro
 * do próprio evento. Só o primeiro pausa o consumo; o segundo volta para a fila
 * e conta no limite de entregas.
 */
export function ehBancoIndisponivel(erro: unknown): boolean {
  if (!erro || typeof erro !== "object") {
    return false;
  }

  const { code, message } = erro as { code?: unknown; message?: unknown };

  if (typeof code === "string") {
    if (CODIGOS_REDE.has(code) || CODIGOS_SERVIDOR_INDISPONIVEL.has(code)) {
      return true;
    }
    // Classe 08 do SQLSTATE: exceções de conexão.
    if (/^08[0-9A-Z]{3}$/.test(code)) {
      return true;
    }
  }

  return typeof message === "string" && MENSAGENS_CONEXAO.some((padrao) => padrao.test(message));
}
