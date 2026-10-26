import "dotenv/config";
import { Pool } from "pg";
import logger from "../utils/logger";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // US-20: sem limite, um banco que não responde segura o evento indefinidamente.
  connectionTimeoutMillis: 5000,
});

pool.on("error", (erro: Error) => {
  logger.error("Erro inesperado na conexão com PostgreSQL", {
    erro: erro.message,
  });
});

export const verificarConexaoBanco = async (): Promise<boolean> => {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
};
