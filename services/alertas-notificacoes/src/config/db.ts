import { Pool, types } from "pg";

// NUMERIC (OID 1700) volta como string por padrão; converte para number.
types.setTypeParser(1700, parseFloat);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on("error", (err: Error) => {
  console.error("Erro inesperado no pool do Postgres", err);
  process.exit(1);
});
