process.env.JWT_SECRET = process.env.JWT_SECRET ?? "segredo-integracao-relatorios";

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import jwt from "jsonwebtoken";
import request from "supertest";
import app from "../../app";
import { pool } from "../../config/db";
import { lidoEm } from "../../utils/formatar-csv";
import {
  apagarSchema,
  cadastrarEstacao,
  cadastrarMedida,
  cadastrarSensor,
  nomeDeSchema,
  prepararSchemaRelatorios,
} from "./helpers/banco-relatorios";

// TASK 31.03 de ponta a ponta: rota HTTP, token e PostgreSQL real. Execute com RELATORIOS_TEST_DATABASE_URL.
const integration = describe;

const SJC = "São José dos Campos";
const emBrasilia = (dataHora: string) => Date.parse(`${dataHora}:00-03:00`) / 1000;
const token = (papel: string, municipio: string | null) =>
  jwt.sign({ id: "usuario-1", papel, municipio }, process.env.JWT_SECRET as string, { algorithm: "HS256" });

integration("medicoes.routes (US-31)", () => {
  const schema = nomeDeSchema("relatorios_rota");
  const admin = `Bearer ${token("ADMINISTRADOR", null)}`;
  const dia = { inicio: "2026-11-06", fim: "2026-11-06" };

  beforeAll(async () => {
    await prepararSchemaRelatorios(pool, schema);
    const centro = await cadastrarEstacao(pool, "EST-001", SJC, "Centro");
    const paulista = await cadastrarEstacao(pool, "EST-SP1", "São Paulo", "Paulista");
    const temperatura = await cadastrarSensor(pool, centro, "T-01", "Temperatura", "°C");
    const umidade = await cadastrarSensor(pool, centro, "U-01", "Umidade Relativa", "%");

    await cadastrarMedida(pool, temperatura, { unixtime: emBrasilia("2026-11-06T11:05"), valor: "23.4", valorBruto: "24.9" });
    await cadastrarMedida(pool, temperatura, { unixtime: emBrasilia("2026-11-06T11:10") });
    await cadastrarMedida(pool, temperatura, { unixtime: emBrasilia("2026-11-06T11:15") });
    await cadastrarMedida(pool, umidade, {
      unixtime: emBrasilia("2026-11-06T11:05"),
      valor: "120.0",
      valorBruto: "120.0",
      valida: false,
    });
    await cadastrarMedida(pool, await cadastrarSensor(pool, paulista, "T-SP"), {
      unixtime: emBrasilia("2026-11-06T11:05"),
    });
  });

  afterAll(async () => {
    await apagarSchema(pool, schema);
  });

  describe("GET /relatorios/medicoes (JSON)", () => {
    it("deve responder 200 com o total e a página pedida quando o token é válido", async () => {
      // Dado:
      const query = { ...dia, municipio: SJC, pagina: 2, porPagina: 3 };

      // Quando:
      const resposta = await request(app).get("/relatorios/medicoes").query(query).set("Authorization", admin);

      // Então:
      expect(resposta.status).toBe(200);
      expect(resposta.headers["cache-control"]).toBe("no-store");
      expect(resposta.body).toMatchObject({
        municipio: SJC,
        inicio: "2026-11-06",
        fim: "2026-11-06",
        pagina: 2,
        porPagina: 3,
        total: 4,
      });
      expect(resposta.body.medicoes).toHaveLength(1);
    });

    it("deve devolver lidoEm em UTC e os números com ponto quando o formato é json", async () => {
      // Dado:
      const query = { ...dia, municipio: SJC, grandeza: "Temperatura", porPagina: 1 };

      // Quando:
      const resposta = await request(app).get("/relatorios/medicoes").query(query).set("Authorization", admin);

      // Então:
      expect(resposta.body.medicoes).toEqual([
        {
          lidoEm: "2026-11-06T14:05:00Z",
          estacaoCodigo: "EST-001",
          estacaoNome: "Centro",
          municipio: SJC,
          sensorCodigo: "T-01",
          grandeza: "Temperatura",
          unidade: "°C",
          valor: 23.4,
          valorBruto: 24.9,
          valida: true,
        },
      ]);
    });

    it("deve trazer a medida inválida com valida = false quando ela está no período", async () => {
      // Dado:
      const query = { ...dia, municipio: SJC, grandeza: "Umidade Relativa" };

      // Quando:
      const resposta = await request(app).get("/relatorios/medicoes").query(query).set("Authorization", admin);

      // Então:
      expect(resposta.body.medicoes).toEqual([expect.objectContaining({ valor: 120, valida: false })]);
    });

    it("deve devolver a lista vazia e total 0 quando o período não tem medições", async () => {
      // Dado:
      const query = { inicio: "2026-10-01", fim: "2026-10-01", municipio: SJC };

      // Quando:
      const resposta = await request(app).get("/relatorios/medicoes").query(query).set("Authorization", admin);

      // Então:
      expect(resposta.status).toBe(200);
      expect(resposta.body).toMatchObject({ total: 0, medicoes: [] });
    });
  });

  describe("GET /relatorios/medicoes (CSV)", () => {
    it("deve responder 200 com Content-Type, Content-Disposition e o BOM quando o formato é csv", async () => {
      // Dado:
      const query = { ...dia, municipio: SJC, formato: "csv" };

      // Quando:
      const resposta = await request(app)
        .get("/relatorios/medicoes")
        .query(query)
        .set("Authorization", admin)
        .buffer(true)
        .parse((res, pronto) => {
          const partes: Buffer[] = [];
          res.on("data", (parte: Buffer) => partes.push(parte));
          res.on("end", () => pronto(null, Buffer.concat(partes)));
        });

      // Então:
      expect(resposta.status).toBe(200);
      expect(resposta.headers["content-type"]).toBe("text/csv; charset=utf-8");
      expect(resposta.headers["content-disposition"]).toBe(
        'attachment; filename="pulso-urbano_medicoes_sao-jose-dos-campos_2026-11-06_2026-11-06.csv"',
      );
      expect(resposta.headers["cache-control"]).toBe("no-store");
      expect([...(resposta.body as Buffer).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    });

    it("deve trazer as mesmas linhas do JSON, com todas as páginas somadas, quando os filtros são iguais", async () => {
      // Dado:
      const filtros = { ...dia, municipio: SJC };
      const doJson: string[] = [];
      for (let pagina = 1; pagina <= 2; pagina++) {
        const { body } = await request(app)
          .get("/relatorios/medicoes")
          .query({ ...filtros, pagina, porPagina: 2 })
          .set("Authorization", admin);
        for (const m of body.medicoes) {
          doJson.push(`${lidoEm(String(Date.parse(m.lidoEm) / 1000))};${m.estacaoCodigo};${m.sensorCodigo}`);
        }
      }

      // Quando:
      const csv = await request(app)
        .get("/relatorios/medicoes")
        .query({ ...filtros, formato: "csv", pagina: 2, porPagina: 1 })
        .set("Authorization", admin);

      // Então:
      const doCsv = csv.text.split("\r\n").slice(1, -1).map((linha) => {
        const campos = linha.split(";");
        return `${campos[0]};${campos[1]};${campos[4]}`;
      });
      expect(doCsv).toHaveLength(4);
      expect(doCsv).toEqual(doJson);
    });
  });

  describe("autenticação", () => {
    it("deve responder 401 quando não vem Authorization", async () => {
      // Dado:
      const query = { ...dia, municipio: SJC };

      // Quando:
      const resposta = await request(app).get("/relatorios/medicoes").query(query);

      // Então:
      expect(resposta.status).toBe(401);
    });

    it("deve responder 401 quando o token foi assinado com outro segredo", async () => {
      // Dado:
      const falso = jwt.sign({ id: "x", papel: "ADMINISTRADOR", municipio: null }, "outro-segredo");

      // Quando:
      const resposta = await request(app)
        .get("/relatorios/medicoes")
        .query(dia)
        .set("Authorization", `Bearer ${falso}`);

      // Então:
      expect(resposta.status).toBe(401);
    });
  });

  describe("isolamento por município", () => {
    it("deve responder 404 quando o gestor de São Paulo pede São José dos Campos", async () => {
      // Dado:
      const gestorSp = `Bearer ${token("GESTOR_PUBLICO", "São Paulo")}`;

      // Quando:
      const resposta = await request(app)
        .get("/relatorios/medicoes")
        .query({ ...dia, municipio: SJC })
        .set("Authorization", gestorSp);

      // Então:
      expect(resposta.status).toBe(404);
      expect(resposta.body).toEqual({ erro: "Município não encontrado." });
    });

    it("deve responder 404 igual quando o município não existe", async () => {
      // Dado:
      const query = { ...dia, municipio: "Atlântida" };

      // Quando:
      const resposta = await request(app).get("/relatorios/medicoes").query(query).set("Authorization", admin);

      // Então:
      expect(resposta.status).toBe(404);
      expect(resposta.body).toEqual({ erro: "Município não encontrado." });
    });
  });

  describe("filtros inválidos", () => {
    it("deve responder 400 quando o fim é antes do início", async () => {
      // Dado:
      const query = { inicio: "2026-11-06", fim: "2026-11-05", municipio: SJC };

      // Quando:
      const resposta = await request(app).get("/relatorios/medicoes").query(query).set("Authorization", admin);

      // Então:
      expect(resposta.status).toBe(400);
      expect(resposta.body).toEqual({ erro: "Período inválido: o fim é antes do início." });
    });

    it("deve responder 400 quando o período tem 32 dias", async () => {
      // Dado:
      const query = { inicio: "2026-11-01", fim: "2026-12-02", municipio: SJC };

      // Quando:
      const resposta = await request(app).get("/relatorios/medicoes").query(query).set("Authorization", admin);

      // Então:
      expect(resposta.status).toBe(400);
      expect(resposta.body).toEqual({ erro: "Período inválido: o máximo é 31 dias." });
    });
  });
});
