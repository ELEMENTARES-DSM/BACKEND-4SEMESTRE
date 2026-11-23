import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import request from "supertest";
import { abrirBancoDeTeste, exigir, macAleatorio, tokenDe } from "../../../tests/integration/ambiente";

const api = request(exigir("TEST_API_URL"));
const pool: Pool = abrirBancoDeTeste();
const token = tokenDe("ADMINISTRADOR");

const codigoEstacao = `IT-CAT-${randomUUID().replace(/-/g, "").slice(0, 20)}`;
let estacaoId = "";

const cadastrar = (corpo: object) =>
  api
    .post(`/estacoes/estacoes/${estacaoId}/sensores`)
    .auth(token, { type: "bearer" })
    .send(corpo)
    .timeout(5000);

beforeAll(async () => {
  const res = await api
    .post("/estacoes")
    .auth(token, { type: "bearer" })
    .send({
      mac_address: macAleatorio(),
      codigo: codigoEstacao,
      nome: "Estação do catálogo",
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
    // sensores prendem a estação (FK RESTRICT): apagar primeiro.
    await pool.query("DELETE FROM sensores WHERE estacao_id IN (SELECT id FROM estacoes WHERE codigo = $1)", [codigoEstacao]);
    await pool.query("DELETE FROM estacoes WHERE codigo = $1", [codigoEstacao]);
  } finally {
    await pool.end();
  }
});

describe("cadastro de sensor com grandeza do catálogo contra o PostgreSQL (US-39)", () => {
  it("deve cadastrar o sensor de Direção do Vento com a unidade do catálogo e gravar no banco", async () => {
    // Quando
    const res = await cadastrar({ codigo: "DIR-01", tipo: "Direção do Vento" });

    // Então
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ tipo: "Direção do Vento", unidade_medida: "°", codigo: "DIR-01" });
    const gravado = await pool.query("SELECT tipo, unidade_medida FROM sensores WHERE id = $1", [res.body.id]);
    expect(gravado.rows).toEqual([{ tipo: "Direção do Vento", unidade_medida: "°" }]);
  });

  it("deve responder 400 e não gravar quando a grandeza não existe no catálogo", async () => {
    // Quando
    const res = await cadastrar({ codigo: "RAD-01", tipo: "Radiação Solar" });

    // Então
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Tipo de sensor "Radiação Solar" não existe no catálogo de grandezas.');
    const r = await pool.query("SELECT 1 FROM sensores WHERE estacao_id = $1 AND tipo = 'Radiação Solar'", [estacaoId]);
    expect(r.rowCount).toBe(0);
  });

  it("deve aceitar a grandeza nova depois que o Administrador a cadastra, sem mudar o código", async () => {
    // Dado
    const nome = `IT-Nebulosidade-${randomUUID().slice(0, 8)}`;
    await api
      .post("/estacoes/tipos-sensor")
      .auth(token, { type: "bearer" })
      .send({ nome, unidade: "%", faixa_min: 0, faixa_max: 100 })
      .timeout(5000)
      .expect(201);

    try {
      // Quando
      const res = await cadastrar({ codigo: "NEB-01", tipo: nome });

      // Então
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ tipo: nome, unidade_medida: "%" });
    } finally {
      await pool.query("DELETE FROM sensores WHERE estacao_id = $1 AND tipo = $2", [estacaoId, nome]);
      await pool.query("DELETE FROM tipos_sensor WHERE nome = $1", [nome]);
    }
  });

  it("deve responder 409 quando a estação já tem sensor da mesma grandeza", async () => {
    // Quando
    const res = await cadastrar({ codigo: "DIR-02", tipo: "Direção do Vento" });

    // Então
    expect(res.status).toBe(409);
  });

  it("deve gravar a unidade de leitura K e devolver K e °C quando o sensor é em Kelvin (Cenário 5)", async () => {
    // Quando
    const res = await cadastrar({
      codigo: "TEMP-K",
      tipo: "Temperatura",
      unidade_leitura: "K",
      fator_conversao: 1,
      offset: -273.15,
    });

    // Então
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      unidade_leitura: "K",
      unidade_medida: "°C",
      fator_conversao: "1.000000",
      offset: "-273.150000",
    });
    expect(res.body).not.toHaveProperty("offset_calibracao");
    const gravado = await pool.query(
      `SELECT unidade_leitura, unidade_medida, fator_conversao::text AS fator,
              offset_calibracao::text AS offset
       FROM sensores WHERE id = $1`,
      [res.body.id],
    );
    expect(gravado.rows).toEqual([
      { unidade_leitura: "K", unidade_medida: "°C", fator: "1.000000", offset: "-273.150000" },
    ]);

    const lista = await api
      .get(`/estacoes/estacoes/${estacaoId}/sensores`)
      .auth(token, { type: "bearer" })
      .timeout(5000);
    expect(lista.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ codigo: "TEMP-K", unidade_leitura: "K" })]),
    );
  });

  it("deve devolver unidade_leitura nula quando o sensor não informa a unidade de leitura", async () => {
    // Quando
    const res = await cadastrar({ codigo: "UMI-01", tipo: "Umidade Relativa" });

    // Então
    expect(res.status).toBe(201);
    expect(res.body.unidade_leitura).toBeNull();
    expect(res.body).toMatchObject({ fator_conversao: "1.000000", offset: "0.000000" });
  });

  it("deve responder 400 quando a unidade de leitura passa de 20 caracteres", async () => {
    // Quando
    const res = await cadastrar({ codigo: "PM-01", tipo: "PM10", unidade_leitura: "u".repeat(21) });

    // Então
    expect(res.status).toBe(400);
  });
});
