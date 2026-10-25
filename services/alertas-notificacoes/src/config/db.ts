import { Pool, types } from "pg";
import logger from "../utils/logger";

// NUMERIC (OID 1700) volta como string por padrão; converte para number.
types.setTypeParser(1700, parseFloat);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // US-23: sem limite, um banco que não responde segura o evento indefinidamente.
  connectionTimeoutMillis: 5000,
});

// Conexão ociosa que cai (banco reiniciado) só é registrada: o pool abre outra
// na próxima consulta, e o consumidor de alarme.disparado espera o banco voltar.
pool.on("error", (erro: Error) => {
  logger.error("Erro inesperado no pool do Postgres", { erro: erro.message });
});

export const verificarConexaoBanco = async (): Promise<boolean> => {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
};
