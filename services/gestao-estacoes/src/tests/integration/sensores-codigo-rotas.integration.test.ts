import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import request from "supertest";
import { abrirBancoDeTeste, exigir, tokenDe, macAleatorio } from "../../../tests/integration/ambiente";

const api = request(exigir("TEST_API_URL"));
const pool: Pool = abrirBancoDeTeste();
const token = tokenDe("ADMINISTRADOR");

const sufixo = randomUUID().replace(/-/g, "").slice(0, 16);
const codigosEstacoes = [`IT-COD-A-${sufixo}`, `IT-COD-B-${sufixo}`];
const ids: string[] = [];

const criarEstacao = async (codigo: string): Promise<string> => {
  const res = await api
    .post("/estacoes")
    .auth(token, { type: "bearer" })
    .send({ mac_address: macAleatorio(), codigo, nome: "Estação do código", municipio: "São José dos Campos", latitude: -23.18, longitude: -45.88 })
    .timeout(5000)
    .expect(201);
  ids.push(res.body.id);
  return res.body.id;
};

const cadastrar = (estacaoId: string, corpo: object) =>
  api
    .post(`/estacoes/estacoes/${estacaoId}/sensores`)
    .auth(token, { type: "bearer" })
    .send(corpo)
    .timeout(5000);

const editar = (sensorId: string, corpo: object) =>
  api
    .put(`/estacoes/sensores/${sensorId}`)
    .auth(token, { type: "bearer" })
    .send(corpo)
    .timeout(5000);

let estacaoA = "";
let estacaoB = "";

beforeAll(async () => {
  estacaoA = await criarEstacao(codigosEstacoes[0]);
  estacaoB = await criarEstacao(codigosEstacoes[1]);
});

afterAll(async () => {
  try {
    // sensores prendem a estação (FK RESTRICT): apagar primeiro.
    await pool.query("DELETE FROM sensores WHERE estacao_id = ANY($1)", [ids]);
    await pool.query("DELETE FROM estacoes WHERE codigo = ANY($1)", [codigosEstacoes]);
  } finally {
    await pool.end();
  }
});

describe("código do sensor único por estação contra o PostgreSQL (US-39)", () => {
  it("deve responder 400 quando o cadastro não informa o código", async () => {
    // Quando
    const res = await cadastrar(estacaoA, { tipo: "Temperatura" });

    // Então
    expect(res.status).toBe(400);
    expect(res.body.errors).toHaveProperty("codigo");
  });

  it("deve responder 409 quando a estação já tem sensor com o código, e aceitar o mesmo código em outra estação (Cenário 6)", async () => {
    // Dado
    await cadastrar(estacaoA, { codigo: "DUP-01", tipo: "Temperatura" }).expect(201);

    // Quando
    const repetido = await cadastrar(estacaoA, { codigo: "DUP-01", tipo: "Umidade Relativa" });
    const outraEstacao = await cadastrar(estacaoB, { codigo: "DUP-01", tipo: "Temperatura" });

    // Então
    expect(repetido.status).toBe(409);
    expect(repetido.body.message).toBe('Já existe um sensor com o código "DUP-01" nesta estação.');
    expect(outraEstacao.status).toBe(201);
  });

  it("deve gravar um e responder 409 no outro quando dois cadastros com o mesmo código chegam juntos", async () => {
    // Dado: grandezas diferentes, para só o código colidir
    const enviar = (tipo: string) => cadastrar(estacaoB, { codigo: "CORRIDA-01", tipo });

    // Quando
    const respostas = await Promise.all([enviar("PM10"), enviar("PM2.5")]);

    // Então: o banco decide e a mensagem é a do código, não a do tipo
    expect(respostas.map((r) => r.status).sort()).toEqual([201, 409]);
    const perdedora = respostas.find((r) => r.status === 409);
    expect(perdedora?.body.message).toBe('Já existe um sensor com o código "CORRIDA-01" nesta estação.');
  });

  it("deve definir o código de um sensor antigo pelo PUT e depois recusar a troca", async () => {
    // Dado: sensor antigo, sem código, criado direto no banco
    const antigo = await pool.query(
      `INSERT INTO sensores (estacao_id, tipo, unidade_medida) VALUES ($1, 'Velocidade do Vento', 'km/h') RETURNING id`,
      [estacaoA],
    );
    const sensorId = antigo.rows[0].id as string;

    // Quando: define o código
    const definido = await editar(sensorId, { tipo: "Velocidade do Vento", codigo: "VENTO-01" });

    // Então
    expect(definido.status).toBe(200);
    expect(definido.body.codigo).toBe("VENTO-01");

    // Quando: tenta trocar
    const troca = await editar(sensorId, { tipo: "Velocidade do Vento", codigo: "VENTO-02" });

    // Então
    expect(troca.status).toBe(409);
    expect(troca.body.message).toBe("O código do sensor não pode ser alterado depois de definido.");
    const r = await pool.query("SELECT codigo FROM sensores WHERE id = $1", [sensorId]);
    expect(r.rows[0].codigo).toBe("VENTO-01");
  });

  it("deve responder 409 quando o código escolhido para o sensor antigo já é de outro sensor da estação", async () => {
    // Dado
    const antigo = await pool.query(
      `INSERT INTO sensores (estacao_id, tipo, unidade_medida) VALUES ($1, 'Pressão Atmosférica', 'hPa') RETURNING id`,
      [estacaoA],
    );

    // Quando: DUP-01 já é de outro sensor da estação A
    const res = await editar(antigo.rows[0].id, { tipo: "Pressão Atmosférica", codigo: "DUP-01" });

    // Então
    expect(res.status).toBe(409);
  });
});
