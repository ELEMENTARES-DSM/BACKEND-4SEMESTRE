import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import request from "supertest";
import { abrirBancoDeTeste, exigir, macAleatorio, tokenDe } from "../../../tests/integration/ambiente";

const api = request(exigir("TEST_API_URL"));
const pool: Pool = abrirBancoDeTeste();
const token = tokenDe("ADMINISTRADOR");

const sufixo = randomUUID().replace(/-/g, "").slice(0, 12);
const codigoEstacao = `IT-MAN-${sufixo}`;
const nomes: string[] = [];
let estacaoId = "";

const nomeUnico = (prefixo: string) => {
  const nome = `IT-${prefixo}-${sufixo}`;
  nomes.push(nome);
  return nome;
};

const criarGrandeza = async (nome: string, extra: object = {}): Promise<string> => {
  const res = await api
    .post("/estacoes/tipos-sensor")
    .auth(token, { type: "bearer" })
    .send({ nome, unidade: "%", faixa_min: 0, faixa_max: 100, ...extra })
    .timeout(5000)
    .expect(201);
  return res.body.id;
};

const alterar = (id: string, corpo: object, jwt = token) =>
  api.put(`/estacoes/tipos-sensor/${id}`).auth(jwt, { type: "bearer" }).send(corpo).timeout(5000);

const excluir = (id: string, jwt = token) =>
  api.delete(`/estacoes/tipos-sensor/${id}`).auth(jwt, { type: "bearer" }).timeout(5000);

const cadastrarSensor = (tipo: string, codigo: string) =>
  api
    .post(`/estacoes/estacoes/${estacaoId}/sensores`)
    .auth(token, { type: "bearer" })
    .send({ codigo, tipo })
    .timeout(5000);

beforeAll(async () => {
  const res = await api
    .post("/estacoes")
    .auth(token, { type: "bearer" })
    .send({
      mac_address: macAleatorio(),
      codigo: codigoEstacao,
      nome: "Estação da manutenção do catálogo",
      municipio: "São José dos Campos",
      latitude: -23.18,
      longitude: -45.88,
    })
    .timeout(5000)
    .expect(201);
  estacaoId = res.body.id;
});

afterAll(async () => {
  try {
    // Sensores prendem a estação e a grandeza: apagar primeiro.
    await pool.query("DELETE FROM sensores WHERE estacao_id = $1", [estacaoId]);
    await pool.query("DELETE FROM estacoes WHERE codigo = $1", [codigoEstacao]);
    await pool.query("DELETE FROM tipos_sensor WHERE nome = ANY($1)", [nomes]);
  } finally {
    await pool.end();
  }
});

describe("PUT e DELETE /estacoes/tipos-sensor/:id contra o PostgreSQL (US-39)", () => {
  it("deve alterar faixa e agregação mesmo com sensor usando a grandeza, e a unidade só sem sensor (Cenário 7)", async () => {
    // Dado: grandeza em uso por um sensor
    const nome = nomeUnico("em-uso");
    const id = await criarGrandeza(nome);
    await cadastrarSensor(nome, "USO-01").expect(201);

    // Quando: muda faixa e agregação
    const faixa = await alterar(id, { faixa_max: 150, agregacao: "soma" });

    // Então: vale, e a linha do banco mudou
    expect(faixa.status).toBe(200);
    expect(faixa.body).toMatchObject({ faixa_max: "150.00", agregacao: "soma", unidade: "%" });
    const gravado = await pool.query("SELECT faixa_max::text, agregacao FROM tipos_sensor WHERE id = $1", [id]);
    expect(gravado.rows).toEqual([{ faixa_max: "150.00", agregacao: "soma" }]);

    // Quando: tenta mudar a unidade com sensor usando
    const unidade = await alterar(id, { unidade: "mm" });

    // Então: 409 com a contagem, e a unidade não mudou
    expect(unidade.status).toBe(409);
    expect(unidade.body.message).toContain("usada por 1 sensor");
    const intacta = await pool.query("SELECT unidade FROM tipos_sensor WHERE id = $1", [id]);
    expect(intacta.rows[0].unidade).toBe("%");
  });

  it("deve trocar a unidade quando nenhum sensor usa a grandeza", async () => {
    // Dado
    const id = await criarGrandeza(nomeUnico("livre"));

    // Quando
    const res = await alterar(id, { unidade: "mm" });

    // Então
    expect(res.status).toBe(200);
    expect(res.body.unidade).toBe("mm");
  });

  it("deve responder 400 quando tenta renomear, quando o corpo é vazio e quando a faixa fica invertida", async () => {
    // Dado
    const id = await criarGrandeza(nomeUnico("valida"));

    // Quando / Então
    const renomear = await alterar(id, { nome: "Outro nome" });
    expect(renomear.status).toBe(400);
    expect(renomear.body.errors.nome).toEqual(["O nome da grandeza não pode ser alterado."]);

    expect((await alterar(id, {})).status).toBe(400);

    // faixa gravada 0 a 100: mínima 100 fica igual à máxima
    expect((await alterar(id, { faixa_min: 100 })).status).toBe(400);
    expect((await alterar(id, { faixa_min: 99.99 })).status).toBe(200);
  });

  it("deve responder 403 para GESTOR_PUBLICO no PUT e no DELETE, sem alterar nada", async () => {
    // Dado
    const nome = nomeUnico("gestor");
    const id = await criarGrandeza(nome);
    const gestor = tokenDe("GESTOR_PUBLICO");

    // Quando / Então
    expect((await alterar(id, { faixa_max: 70 }, gestor)).status).toBe(403);
    expect((await excluir(id, gestor)).status).toBe(403);
    const r = await pool.query("SELECT faixa_max::text FROM tipos_sensor WHERE nome = $1", [nome]);
    expect(r.rows[0].faixa_max).toBe("100.00");
  });

  it("deve responder 404 quando a grandeza não existe", async () => {
    const inexistente = randomUUID();

    expect((await alterar(inexistente, { faixa_max: 70 })).status).toBe(404);
    expect((await excluir(inexistente)).status).toBe(404);
  });

  it("deve responder 409 com a mensagem clara ao excluir uma grandeza em uso e manter a linha (Cenário 8)", async () => {
    // Dado
    const nome = nomeUnico("excl-uso");
    const id = await criarGrandeza(nome);
    await cadastrarSensor(nome, "EXC-01").expect(201);

    // Quando
    const res = await excluir(id);

    // Então
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(
      "Esta grandeza é usada por 1 sensor e não pode ser excluída. " +
        "Sensores com medidas não podem ser removidos; para parar de usá-la, inative os sensores.",
    );
    const r = await pool.query("SELECT 1 FROM tipos_sensor WHERE id = $1", [id]);
    expect(r.rowCount).toBe(1);
  });

  it("deve manter a grandeza em uso excluída-bloqueada mesmo com o sensor inativo", async () => {
    // Dado: inativar o sensor não libera a grandeza (sensor não pode ser removido)
    const nome = nomeUnico("excl-inativo");
    const id = await criarGrandeza(nome);
    const sensor = await cadastrarSensor(nome, "EXC-02").expect(201);
    await api
      .patch(`/estacoes/sensores/${sensor.body.id}/status`)
      .auth(token, { type: "bearer" })
      .send({ status: "Inativo" })
      .timeout(5000)
      .expect(200);

    // Quando
    const res = await excluir(id);

    // Então
    expect(res.status).toBe(409);
  });

  it("deve responder 204 e apagar a linha quando a grandeza nunca foi usada (Cenário 8)", async () => {
    // Dado
    const nome = nomeUnico("excl-livre");
    const id = await criarGrandeza(nome);

    // Quando
    const res = await excluir(id);

    // Então
    expect(res.status).toBe(204);
    const r = await pool.query("SELECT 1 FROM tipos_sensor WHERE id = $1", [id]);
    expect(r.rowCount).toBe(0);
  });

});
