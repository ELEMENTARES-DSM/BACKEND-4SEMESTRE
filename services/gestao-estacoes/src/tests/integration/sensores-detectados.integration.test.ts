import { randomUUID } from "node:crypto";
import path from "node:path";
import { Pool } from "pg";
import request from "supertest";
import { abrirBancoDeTeste, exigir, tokenDe } from "../../../tests/integration/ambiente";

const api = request(exigir("TEST_API_URL"));
const pool: Pool = abrirBancoDeTeste();
const token = tokenDe("ADMINISTRADOR");

const sufixo = randomUUID().replace(/-/g, "").slice(0, 16);
const codigosEstacoes = [`IT-DET-A-${sufixo}`, `IT-DET-B-${sufixo}`];
let estacaoA = "";
let estacaoB = "";
// O staging é da ingestão-dados: o banco de teste do gestao-estacoes só tem as tabelas deste serviço.
let criouStaging = false;

const agora = Math.floor(Date.now() / 1000);
const minutosAtras = (minutos: number) => agora - minutos * 60;

const criarEstacao = async (codigo: string): Promise<string> => {
  const res = await api
    .post("/estacoes")
    .auth(token, { type: "bearer" })
    .send({ codigo, nome: "Estação dos códigos detectados", municipio: "São José dos Campos", latitude: -23.18, longitude: -45.88 })
    .timeout(5000)
    .expect(201);
  return res.body.id;
};

const cadastrar = (estacaoId: string, corpo: object) =>
  api
    .post(`/estacoes/estacoes/${estacaoId}/sensores`)
    .auth(token, { type: "bearer" })
    .send(corpo)
    .timeout(5000);

const detectados = (estacaoId: string, jwt = token) =>
  api
    .get(`/estacoes/estacoes/${estacaoId}/sensores/detectados`)
    .auth(jwt, { type: "bearer" })
    .timeout(5000);

/** Grava uma mensagem no staging como a ingestão grava (payload já validado). */
const mensagem = (
  estacaoId: string,
  unixtime: number,
  leituras: unknown,
  status: "publicada" | "rejeitada" = "publicada",
) =>
  pool.query(
    `INSERT INTO staging_telemetria
       (id, estacao_uuid, unixtime, payload_bruto, payload, status, motivo_rejeicao, criado_em)
     VALUES (gen_random_uuid(), $1, $2, $3, $4::jsonb, $5, $6, now())`,
    [
      estacaoId,
      unixtime,
      JSON.stringify({ leituras }),
      JSON.stringify({ leituras }),
      status,
      status === "rejeitada" ? "Estação inativa" : null,
    ],
  );

beforeAll(async () => {
  const existe = await pool.query("SELECT to_regclass('public.staging_telemetria') AS tabela");
  if (existe.rows[0].tabela === null) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const migration = require(
      path.resolve(__dirname, "../../../../ingestao-dados/src/db/migrations/1791986171448_create-staging-telemetria.cjs"),
    ) as { up: (pgm: { sql: (texto: string) => void }) => void };
    const comandos: string[] = [];
    migration.up({ sql: (texto) => comandos.push(texto) });
    for (const comando of comandos) await pool.query(comando);
    criouStaging = true;
  }

  estacaoA = await criarEstacao(codigosEstacoes[0]);
  estacaoB = await criarEstacao(codigosEstacoes[1]);
});

afterAll(async () => {
  try {
    await pool.query("DELETE FROM staging_telemetria WHERE estacao_uuid = ANY($1)", [[estacaoA, estacaoB]]);
    await pool.query("DELETE FROM sensores WHERE estacao_id = ANY($1)", [[estacaoA, estacaoB]]);
    await pool.query("DELETE FROM estacoes WHERE codigo = ANY($1)", [codigosEstacoes]);
    if (criouStaging) await pool.query("DROP TABLE IF EXISTS staging_telemetria");
  } finally {
    await pool.end();
  }
});

describe("GET /estacoes/estacoes/:id/sensores/detectados contra o PostgreSQL (US-39)", () => {
  it("deve listar só os códigos que a estação mandou e ainda não têm sensor nela", async () => {
    // Dado: PM25 (ativo) e PM10 (inativo) já cadastrados na estação A
    await cadastrar(estacaoA, { codigo: "PM25", tipo: "PM2.5" }).expect(201);
    const pm10 = await cadastrar(estacaoA, { codigo: "PM10", tipo: "PM10" }).expect(201);
    await api
      .patch(`/estacoes/sensores/${pm10.body.id}/status`)
      .auth(token, { type: "bearer" })
      .send({ status: "Inativo" })
      .timeout(5000)
      .expect(200);
    // Outra estação com um sensor de código DIR-01: não pode esconder o DIR-01 da estação A
    await cadastrar(estacaoB, { codigo: "DIR-01", tipo: "Direção do Vento" }).expect(201);

    // E a estação A mandou estes códigos (a mais recente primeiro: DIR-01, depois CHUVA-01)
    await mensagem(estacaoA, minutosAtras(30), [
      { sensor: "PM25", valor: 10 },
      { sensor: "PM10", valor: 18 },
      { sensor: "CHUVA-01", valor: 0.4 },
    ]);
    await mensagem(estacaoA, minutosAtras(20), [{ sensor: "DIR-01", valor: 90 }]);
    await mensagem(estacaoA, minutosAtras(10), [
      { sensor: "DIR-01", valor: 270 },
      { sensor: "pm25", valor: 12 }, // maiúsculas diferentes: não casa com PM25 e aparece
    ]);

    // Quando
    const res = await detectados(estacaoA);

    // Então
    expect(res.status).toBe(200);
    expect(res.body.map((d: { codigo: string }) => d.codigo)).toEqual(["DIR-01", "pm25", "CHUVA-01"]);
    // PM25 (ativo) e PM10 (inativo) não aparecem; DIR-01 aparece apesar de existir na estação B
  });

  it("deve trazer o total, o valor da leitura mais recente e o horário dela", async () => {
    // Quando
    const res = await detectados(estacaoA);

    // Então
    const dir = res.body.find((d: { codigo: string }) => d.codigo === "DIR-01");
    expect(dir).toEqual({
      codigo: "DIR-01",
      total: 2,
      ultimo_valor: 270,
      ultima_leitura_em: new Date(minutosAtras(10) * 1000).toISOString(),
    });
  });

  it("deve ignorar mensagem rejeitada, leitura fora da janela de 7 dias, código com espaço, código longo e payload fora do padrão", async () => {
    // Dado
    await mensagem(estacaoA, minutosAtras(5), [{ sensor: "REJEITADA-01", valor: 1 }], "rejeitada");
    await mensagem(estacaoA, agora - 8 * 86400, [{ sensor: "ANTIGO-01", valor: 1 }]);
    await mensagem(estacaoA, minutosAtras(4), [
      { sensor: " ESPACO", valor: 1 },
      { sensor: "A".repeat(31), valor: 1 },
      { sensor: "", valor: 1 },
      { sensor: 42, valor: 1 },
      "texto solto",
      null,
    ]);
    await mensagem(estacaoA, minutosAtras(3), "isto não é uma lista");

    // Quando
    const res = await detectados(estacaoA);

    // Então: a lista continua só com os três de antes
    expect(res.status).toBe(200);
    expect(res.body.map((d: { codigo: string }) => d.codigo)).toEqual(["DIR-01", "pm25", "CHUVA-01"]);
  });

  it("deve tirar o código da lista assim que o sensor é cadastrado", async () => {
    // Quando
    await cadastrar(estacaoA, { codigo: "DIR-01", tipo: "Direção do Vento" }).expect(201);
    const res = await detectados(estacaoA);

    // Então
    expect(res.body.map((d: { codigo: string }) => d.codigo)).toEqual(["pm25", "CHUVA-01"]);
  });

  it("deve devolver lista vazia para a estação que não mandou nada e 404 para estação que não existe", async () => {
    expect((await detectados(estacaoB)).body).toEqual([]);
    expect((await detectados(randomUUID())).status).toBe(404);
  });

  it("deve responder 401 sem token, 403 para PESQUISADOR e 400 para id inválido", async () => {
    expect((await api.get(`/estacoes/estacoes/${estacaoA}/sensores/detectados`).timeout(5000)).status).toBe(401);
    expect((await detectados(estacaoA, tokenDe("PESQUISADOR"))).status).toBe(403);
    expect((await detectados("nao-e-uuid")).status).toBe(400);
  });
});
