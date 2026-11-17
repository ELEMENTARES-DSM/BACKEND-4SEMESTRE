import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import request from "supertest";
import { abrirBancoDeTeste, exigir, tokenDe } from "../../../tests/integration/ambiente";

const api = request(exigir("TEST_API_URL"));
const pool: Pool = abrirBancoDeTeste();

const nomesCriados: string[] = [];
const nomeUnico = (prefixo: string) => {
  const nome = `IT-${prefixo}-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  nomesCriados.push(nome);
  return nome;
};

afterAll(async () => {
  try {
    // Apaga também quando o POST gravou e uma verificação falhou.
    await pool.query("DELETE FROM tipos_sensor WHERE nome = ANY($1)", [nomesCriados]);
  } finally {
    await pool.end();
  }
});

describe("GET e POST /estacoes/tipos-sensor contra o PostgreSQL (US-39)", () => {
  it("deve listar as 8 grandezas da carga, com a agregação de cada uma, e não cair em GET /estacoes/:id", async () => {
    // Quando
    const res = await api
      .get("/estacoes/tipos-sensor")
      .auth(tokenDe("GESTOR_PUBLICO"), { type: "bearer" })
      .timeout(5000);

    // Então
    expect(res.status).toBe(200);
    const porNome = new Map(res.body.map((t: { nome: string }) => [t.nome, t]));
    expect(porNome.get("Direção do Vento")).toMatchObject({
      unidade: "°", faixa_min: "0.00", faixa_max: "360.00", agregacao: "media_circular",
    });
    expect(porNome.get("Precipitação")).toMatchObject({ unidade: "mm", agregacao: "soma" });
    expect(porNome.get("Temperatura")).toMatchObject({ faixa_min: "-50.00", agregacao: "media" });
    for (const nome of [
      "Temperatura", "Umidade Relativa", "PM2.5", "PM10", "Velocidade do Vento",
      "Direção do Vento", "Precipitação", "Pressão Atmosférica",
    ]) {
      expect(porNome.has(nome)).toBe(true);
    }
  });

  it("deve responder 401 quando não há token", async () => {
    await api.get("/estacoes/tipos-sensor").timeout(5000).expect(401);
  });

  it("deve cadastrar e gravar no banco quando um ADMINISTRADOR envia a grandeza", async () => {
    // Dado
    const nome = nomeUnico("cria");

    // Quando
    const res = await api
      .post("/estacoes/tipos-sensor")
      .auth(tokenDe("ADMINISTRADOR"), { type: "bearer" })
      .send({ nome, unidade: "%", faixa_min: 0, faixa_max: 100 })
      .timeout(5000);

    // Então
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      nome, unidade: "%", faixa_min: "0.00", faixa_max: "100.00", agregacao: "media",
    });
    const gravado = await pool.query("SELECT unidade, agregacao FROM tipos_sensor WHERE nome = $1", [nome]);
    expect(gravado.rows).toEqual([{ unidade: "%", agregacao: "media" }]);
  });

  it("deve responder 403 e não gravar quando o perfil é GESTOR_PUBLICO", async () => {
    // Dado
    const nome = nomeUnico("gestor");

    // Quando
    const res = await api
      .post("/estacoes/tipos-sensor")
      .auth(tokenDe("GESTOR_PUBLICO"), { type: "bearer" })
      .send({ nome, unidade: "%", faixa_min: 0, faixa_max: 100 })
      .timeout(5000);

    // Então
    expect(res.status).toBe(403);
    const r = await pool.query("SELECT 1 FROM tipos_sensor WHERE nome = $1", [nome]);
    expect(r.rowCount).toBe(0);
  });

  it("deve responder 400 quando faixa_min é maior ou igual a faixa_max e quando a agregação é inválida", async () => {
    const token = tokenDe("ADMINISTRADOR");

    const igual = await api.post("/estacoes/tipos-sensor").auth(token, { type: "bearer" })
      .send({ nome: nomeUnico("igual"), unidade: "u", faixa_min: 5, faixa_max: 5 }).timeout(5000);
    const agregacao = await api.post("/estacoes/tipos-sensor").auth(token, { type: "bearer" })
      .send({ nome: nomeUnico("agr"), unidade: "u", faixa_min: 0, faixa_max: 5, agregacao: "mediana" }).timeout(5000);

    expect(igual.status).toBe(400);
    expect(agregacao.status).toBe(400);
  });

  it("deve responder 409 com a mensagem da grandeza quando o nome já existe", async () => {
    // Quando
    const res = await api
      .post("/estacoes/tipos-sensor")
      .auth(tokenDe("ADMINISTRADOR"), { type: "bearer" })
      .send({ nome: "Temperatura", unidade: "°C", faixa_min: -50, faixa_max: 60 })
      .timeout(5000);

    // Então
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Já existe uma grandeza com o nome "Temperatura" no catálogo.');
  });

  it("deve gravar uma e responder 409 na outra quando dois POST com o mesmo nome chegam juntos", async () => {
    // Dado
    const nome = nomeUnico("corrida");
    const token = tokenDe("ADMINISTRADOR");
    const enviar = () =>
      api.post("/estacoes/tipos-sensor").auth(token, { type: "bearer" })
        .send({ nome, unidade: "u", faixa_min: 0, faixa_max: 10 }).timeout(5000);

    // Quando
    const respostas = await Promise.all([enviar(), enviar()]);

    // Então
    expect(respostas.map((r) => r.status).sort()).toEqual([201, 409]);
    const perdedora = respostas.find((r) => r.status === 409);
    expect(perdedora?.body.message).toBe(`Já existe uma grandeza com o nome "${nome}" no catálogo.`);
  });
});
