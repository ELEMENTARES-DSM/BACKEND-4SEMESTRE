import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import request from "supertest";
import { abrirBancoDeTeste, abrirValkeyDeTeste, exigir, tokenDe } from "../../../tests/integration/ambiente";

const api = request(exigir("TEST_API_URL"));
const pool: Pool = abrirBancoDeTeste();
const token = tokenDe("ADMINISTRADOR");

const sufixo = randomUUID().replace(/-/g, "").slice(0, 16);
const codigosEstacoes = [`IT-DET-A-${sufixo}`, `IT-DET-B-${sufixo}`, `IT-DET-C-${sufixo}`];
let estacaoA = "";
let estacaoB = "";
let estacaoSemMensagens = "";
let valkey: Awaited<ReturnType<typeof abrirValkeyDeTeste>>;
// Chaves criadas por este arquivo: o Valkey de teste é o mesmo que a API lê.
const chavesCriadas: string[] = [];

const inicio = Date.now();
const minutosAtras = (minutos: number) => new Date(inicio - minutos * 60 * 1000);
const diasAtras = (dias: number) => new Date(inicio - dias * 24 * 60 * 60 * 1000);

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

const codigosDe = (res: { body: { codigo: string }[] }) => res.body.map((d) => d.codigo);

/**
 * Grava uma mensagem no staging do Valkey como a ingestão grava: um hash
 * staging:msg:{id} com topico, conteudo (o payload como chegou), recebidoEm e status.
 */
const mensagem = async (
  estacaoUuid: string,
  quando: Date,
  leituras: unknown,
  status = "encaminhada",
  topico = `pulso/estacoes/${estacaoUuid}/telemetria`,
) => {
  const chave = `staging:msg:${randomUUID()}`;
  chavesCriadas.push(chave);
  await valkey.hSet(chave, {
    topico,
    conteudo: JSON.stringify({ timestamp: quando.toISOString(), leituras }),
    recebidoEm: quando.toISOString(),
    status,
  });
};

beforeAll(async () => {
  valkey = await abrirValkeyDeTeste();
  estacaoA = await criarEstacao(codigosEstacoes[0]);
  estacaoB = await criarEstacao(codigosEstacoes[1]);
  estacaoSemMensagens = await criarEstacao(codigosEstacoes[2]);
});

afterAll(async () => {
  try {
    if (chavesCriadas.length > 0) await valkey.del(chavesCriadas);
    await pool.query("DELETE FROM sensores WHERE estacao_id = ANY($1)", [[estacaoA, estacaoB, estacaoSemMensagens]]);
    await pool.query("DELETE FROM estacoes WHERE codigo = ANY($1)", [codigosEstacoes]);
  } finally {
    await valkey.quit();
    await pool.end();
  }
});

describe("GET /estacoes/estacoes/:id/sensores/detectados contra o Valkey e o PostgreSQL (US-39)", () => {
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

    // Então: PM25 (ativo) e PM10 (inativo) não aparecem; DIR-01 aparece apesar de existir na estação B
    expect(res.status).toBe(200);
    expect(codigosDe(res)).toEqual(["DIR-01", "pm25", "CHUVA-01"]);
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
      ultima_leitura_em: minutosAtras(10).toISOString(),
    });
  });

  it("deve ignorar mensagem não verificada, de outra estação e fora da janela, e o código ou o payload fora do padrão", async () => {
    // Dado: só "pendente" e "encaminhada" passaram na verificação da ingestão
    await mensagem(estacaoA, minutosAtras(5), [{ sensor: "RECUSADA-01", valor: 1 }], "recusada");
    await mensagem(estacaoA, minutosAtras(5), [{ sensor: "RECEBIDA-01", valor: 1 }], "recebida");
    await mensagem(estacaoA, minutosAtras(5), [{ sensor: "DUPLICADA-01", valor: 1 }], "duplicada");
    // outra estação, e outro tópico que não é o de telemetria
    await mensagem(estacaoB, minutosAtras(5), [{ sensor: "DA-OUTRA-01", valor: 1 }]);
    await mensagem(estacaoA, minutosAtras(5), [{ sensor: "OUTRO-TOPICO-01", valor: 1 }], "encaminhada", `pulso/estacoes/${estacaoA}/status`);
    // fora da janela de 7 dias
    await mensagem(estacaoA, diasAtras(8), [{ sensor: "ANTIGO-01", valor: 1 }]);
    // códigos e itens que não dá para cadastrar
    await mensagem(estacaoA, minutosAtras(4), [
      { sensor: " ESPACO", valor: 1 },
      { sensor: "A".repeat(31), valor: 1 },
      { sensor: "", valor: 1 },
      { sensor: 42, valor: 1 },
      "texto solto",
      null,
    ]);
    // payload fora do padrão: leituras não é lista, e conteúdo que nem é JSON
    await mensagem(estacaoA, minutosAtras(3), "isto não é uma lista");
    const chaveQuebrada = `staging:msg:${randomUUID()}`;
    chavesCriadas.push(chaveQuebrada);
    await valkey.hSet(chaveQuebrada, {
      topico: `pulso/estacoes/${estacaoA}/telemetria`,
      conteudo: "{quebrado",
      recebidoEm: minutosAtras(3).toISOString(),
      status: "encaminhada",
    });

    // Quando
    const res = await detectados(estacaoA);

    // Então: a lista continua só com os três de antes
    expect(res.status).toBe(200);
    expect(codigosDe(res)).toEqual(["DIR-01", "pm25", "CHUVA-01"]);
  });

  it("deve contar a mensagem pendente e a de tópico com o UUID em maiúsculas", async () => {
    // Dado
    await mensagem(estacaoA, minutosAtras(2), [{ sensor: "PENDENTE-01", valor: 5 }], "pendente");
    await mensagem(estacaoA, minutosAtras(1), [{ sensor: "MAIUSCULAS-01", valor: 6 }], "encaminhada", `pulso/estacoes/${estacaoA.toUpperCase()}/telemetria`);

    // Quando
    const res = await detectados(estacaoA);

    // Então
    expect(codigosDe(res)).toEqual(["MAIUSCULAS-01", "PENDENTE-01", "DIR-01", "pm25", "CHUVA-01"]);
  });

  it("deve tirar o código da lista assim que o sensor é cadastrado", async () => {
    // Quando
    await cadastrar(estacaoA, { codigo: "DIR-01", tipo: "Direção do Vento" }).expect(201);
    const res = await detectados(estacaoA);

    // Então
    expect(codigosDe(res)).toEqual(["MAIUSCULAS-01", "PENDENTE-01", "pm25", "CHUVA-01"]);
  });

  it("deve devolver lista vazia para a estação que não mandou nada e 404 para estação que não existe", async () => {
    expect((await detectados(estacaoSemMensagens)).body).toEqual([]);
    expect((await detectados(randomUUID())).status).toBe(404);
  });

  it("deve responder 401 sem token, 403 para PESQUISADOR e 400 para id inválido", async () => {
    expect((await api.get(`/estacoes/estacoes/${estacaoA}/sensores/detectados`).timeout(5000)).status).toBe(401);
    expect((await detectados(estacaoA, tokenDe("PESQUISADOR"))).status).toBe(403);
    expect((await detectados("nao-e-uuid")).status).toBe(400);
  });
});
