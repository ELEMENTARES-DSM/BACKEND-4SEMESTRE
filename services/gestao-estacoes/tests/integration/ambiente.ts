import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { Pool } from "pg";

/**
 * Apoio dos testes de integração. As variáveis TEST_* vêm do
 * scripts/test-integration.sh (npm test na raiz), que sobe o PostgreSQL e a
 * API em contêineres descartáveis.
 */
export function exigir(nome: string): string {
  const valor = process.env[nome];
  if (!valor) throw new Error(`${nome} ausente. Execute npm test na raiz do projeto.`);
  return valor;
}

export function abrirBancoDeTeste(): Pool {
  const url = exigir("TEST_DATABASE_URL");
  if (new URL(url).pathname !== "/estacoes_test") {
    throw new Error("O teste exige o banco exclusivo estacoes_test.");
  }
  return new Pool({ connectionString: url, connectionTimeoutMillis: 5000, query_timeout: 5000 });
}

export function tokenDe(papel: string): string {
  return jwt.sign(
    { id: randomUUID(), papel, municipio: "São José dos Campos" },
    exigir("TEST_JWT_SECRET"),
    { expiresIn: "5m" },
  );
}
