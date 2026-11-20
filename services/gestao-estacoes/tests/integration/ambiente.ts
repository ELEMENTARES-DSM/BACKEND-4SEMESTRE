import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { Pool } from "pg";
import { createClient } from "redis";

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

/**
 * Cliente do Valkey de teste (TEST_VALKEY_URL), o mesmo que a API do teste lê.
 * Quem abre fecha com `await cliente.quit()`.
 */
export async function abrirValkeyDeTeste(): Promise<ReturnType<typeof createClient>> {
  const cliente = createClient({ url: exigir("TEST_VALKEY_URL") });
  cliente.on("error", () => undefined);
  await cliente.connect();
  return cliente;
}
