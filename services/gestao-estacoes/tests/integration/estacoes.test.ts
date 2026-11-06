import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { Pool } from "pg";
import request from "supertest";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} ausente. Execute npm test na raiz do projeto.`);
  return value;
}

const databaseUrl = required("TEST_DATABASE_URL");
if (new URL(databaseUrl).pathname !== "/estacoes_test") {
  throw new Error("O teste exige o banco exclusivo estacoes_test.");
}
const api = request(required("TEST_API_URL"));
const token = jwt.sign(
  { id: randomUUID(), papel: "ADMINISTRADOR" },
  required("TEST_JWT_SECRET"),
  { expiresIn: "5m" },
);
const internalToken = required("TEST_INTERNAL_TOKEN");
const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000, query_timeout: 5000 });
const codigo = `IT-${randomUUID().replace(/-/g, "").slice(0, 24)}`;
const codigoInativacao = `IT-INAT-${randomUUID().replace(/-/g, "").slice(0, 20)}`;

afterAll(async () => {
  try {
    // Use the known code even when POST persisted data but an assertion failed.
    await pool.query("DELETE FROM estacoes WHERE codigo = ANY($1)", [[codigo, codigoInativacao]]);
  } finally {
    await pool.end();
  }
});

test("cadastra e consulta uma estação, persistindo os dados no PostgreSQL", async () => {
  const payload = {
    codigo,
    nome: "Estação de integração",
    municipio: "São José dos Campos",
    latitude: -23.18,
    longitude: -45.88,
  };
  const created = await api.post("/estacoes")
    .auth(token, { type: "bearer" }).send(payload).timeout(5000).expect(201);
  expect(created.body.id).toMatch(/^[0-9a-f-]{36}$/i);
  expect(created.body).toMatchObject({ codigo, nome: payload.nome, municipio: payload.municipio, status: "Ativa" });

  const found = await api.get(`/estacoes/${created.body.id}`)
    .auth(token, { type: "bearer" }).timeout(5000).expect(200);
  expect(found.body).toEqual(created.body);

  const result = await pool.query("SELECT * FROM estacoes WHERE codigo = $1", [codigo]);
  expect(result.rowCount).toBe(1);
  expect(result.rows[0]).toMatchObject({
    id: created.body.id, codigo, nome: payload.nome, municipio: payload.municipio, status: "Ativa",
  });
  for (const record of [created.body, found.body, result.rows[0]]) {
    expect(Number(record.latitude)).toBeCloseTo(payload.latitude, 6);
    expect(Number(record.longitude)).toBeCloseTo(payload.longitude, 6);
    expect(record.criado_em).toBeTruthy();
  }
});

describe("PATCH /api/v1/internal/estacoes/:uuid/inativar", () => {
  test("responde 401 quando X-Internal-Token está ausente ou incorreto", async () => {
    const uuidQualquer = randomUUID();

    await api
      .patch(`/api/v1/internal/estacoes/${uuidQualquer}/inativar`)
      .timeout(5000)
      .expect(401);

    await api
      .patch(`/api/v1/internal/estacoes/${uuidQualquer}/inativar`)
      .set("X-Internal-Token", "token-invalido")
      .timeout(5000)
      .expect(401);
  });

  test("responde 404 para estação inexistente", async () => {
    const uuidInexistente = randomUUID();

    await api
      .patch(`/api/v1/internal/estacoes/${uuidInexistente}/inativar`)
      .set("X-Internal-Token", internalToken)
      .timeout(5000)
      .expect(404);
  });

  test("responde 200 e grava a estação como Inativa no banco de dados", async () => {
    const payload = {
      codigo: codigoInativacao,
      nome: "Estação para inativação interna",
      municipio: "São José dos Campos",
      latitude: -23.19,
      longitude: -45.89,
    };

    const created = await api
      .post("/estacoes")
      .auth(token, { type: "bearer" })
      .send(payload)
      .timeout(5000)
      .expect(201);

    expect(created.body.status).toBe("Ativa");

    const response = await api
      .patch(`/api/v1/internal/estacoes/${created.body.id}/inativar`)
      .set("X-Internal-Token", internalToken)
      .timeout(5000)
      .expect(200);

    expect(response.body).toMatchObject({
      id: created.body.id,
      codigo: codigoInativacao,
      status: "Inativa",
    });

    const result = await pool.query(
      "SELECT status FROM estacoes WHERE id = $1",
      [created.body.id],
    );
    expect(result.rowCount).toBe(1);
    expect(result.rows[0].status).toBe("Inativa");
  });
});

