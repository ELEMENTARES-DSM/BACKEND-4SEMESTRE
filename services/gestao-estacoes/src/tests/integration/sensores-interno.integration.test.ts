import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import request from "supertest";
import { abrirBancoDeTeste, exigir, tokenDe } from "../../../tests/integration/ambiente";

const api = request(exigir("TEST_API_URL"));
const pool: Pool = abrirBancoDeTeste();
const token = tokenDe("ADMINISTRADOR");
const tokenInterno = exigir("TEST_INTERNAL_TOKEN");

const codigoEstacao = `IT-SIM-${randomUUID().replace(/-/g, "").slice(0, 20)}`;
let estacaoId = "";

const cadastrar = (corpo: object) =>
  api
    .post(`/estacoes/estacoes/${estacaoId}/sensores`)
    .auth(token, { type: "bearer" })
    .send(corpo)
    .timeout(5000);

const listar = (caminho: string, tokenDaRota?: string) => {
  const chamada = api.get(caminho).timeout(5000);
  return tokenDaRota ? chamada.set("x-internal-token", tokenDaRota) : chamada;
};

beforeAll(async () => {
  const res = await api
    .post("/estacoes")
    .auth(token, { type: "bearer" })
    .send({
      codigo: codigoEstacao,
      nome: "Estação do simulador",
      municipio: "São José dos Campos",
      latitude: -23.18,
      longitude: -45.88,
    })
    .timeout(5000)
    .expect(201);
  estacaoId = res.body.id;

  await cadastrar({ codigo: "CHUVA-01", tipo: "Precipitação" }).expect(201);
  await cadastrar({ codigo: "PRES-01", tipo: "Pressão Atmosférica" }).expect(201);
  await cadastrar({
    codigo: "TEMP-K",
    tipo: "Temperatura",
    unidade_leitura: "K",
    fator_conversao: 1,
    offset: -273.15,
  }).expect(201);
  // Sensor antigo, sem código: não há o que a placa enviar, então não entra na lista.
  await pool.query(
    "INSERT INTO sensores (estacao_id, tipo, unidade_medida) VALUES ($1, 'Direção do Vento', '°')",
    [estacaoId],
  );
});

afterAll(async () => {
  try {
    await pool.query("DELETE FROM sensores WHERE estacao_id = $1", [estacaoId]);
    await pool.query("DELETE FROM estacoes WHERE codigo = $1", [codigoEstacao]);
  } finally {
    await pool.end();
  }
});

describe("GET /api/v1/internal/estacoes/:uuid/sensores contra o PostgreSQL (US-39)", () => {
  const caminho = () => `/api/v1/internal/estacoes/${estacaoId}/sensores`;

  it("deve listar os sensores com a faixa do catálogo e a calibração, ordenados pelo código, sem o sensor sem código", async () => {
    // Quando
    const res = await listar(caminho(), tokenInterno);

    // Então
    expect(res.status).toBe(200);
    expect(res.body.map((s: { codigo: string }) => s.codigo)).toEqual(["CHUVA-01", "PRES-01", "TEMP-K"]);
    expect(res.body[0]).toEqual({
      codigo: "CHUVA-01",
      tipo: "Precipitação",
      unidade: "mm",
      faixa_min: "0.00",
      faixa_max: "500.00",
      fator_conversao: "1.000000",
      offset: "0.000000",
      status: "Ativo",
    });
    expect(res.body[1]).toMatchObject({ tipo: "Pressão Atmosférica", faixa_min: "600.00", faixa_max: "1100.00" });
    expect(res.body[2]).toMatchObject({ unidade: "°C", fator_conversao: "1.000000", offset: "-273.150000" });
  });

  it("deve responder o mesmo pelo caminho montado em /estacoes", async () => {
    // Quando
    const res = await listar(`/estacoes${caminho()}`, tokenInterno);

    // Então
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
  });

  it("deve responder 401 sem o token interno e com o JWT de usuário", async () => {
    expect((await listar(caminho())).status).toBe(401);
    const comJwt = await api.get(caminho()).auth(token, { type: "bearer" }).timeout(5000);
    expect(comJwt.status).toBe(401);
  });

  it("deve responder 404 quando a estação não existe e 400 quando o uuid é inválido", async () => {
    expect((await listar(`/api/v1/internal/estacoes/${randomUUID()}/sensores`, tokenInterno)).status).toBe(404);
    expect((await listar("/api/v1/internal/estacoes/nao-e-uuid/sensores", tokenInterno)).status).toBe(400);
  });
});
