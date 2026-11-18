import "dotenv/config";
import { Pool } from "pg";
import logger from "../utils/logger";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (erro: Error) => {
  logger.error("Erro inesperado na conexão com PostgreSQL", {
    erro: erro.message,
  });
});
