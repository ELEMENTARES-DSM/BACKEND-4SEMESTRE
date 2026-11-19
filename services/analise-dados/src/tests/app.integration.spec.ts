import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

import app from "../app";
import {
  authenticate,
  PERFIS,
} from "../middlewares/auth.middleware";
import { verificarMunicipio } from "../middlewares/municipio.middleware";

const JWT_SECRET = "segredo-integracao-teste";

function criarToken(
  papel: string,
  municipio: string | null,
) {
  return jwt.sign(
    {
      id: "usuario-teste",
      papel,
      municipio,
    },
    JWT_SECRET,
    {
      algorithm: "HS256",
      expiresIn: "1h",
    },
  );
}

// Aplicação temporária para testar os middlewares por HTTP.
// Não adiciona rotas à aplicação real do serviço.
const appTeste = express();

appTeste.get(
  "/teste/municipios",
  authenticate,
  verificarMunicipio,
  (req, res) => {
    res.json({
      municipio: req.municipioEscopo ?? null,
    });
  },
);

describe("Integração do serviço analise-dados", () => {
  beforeAll(() => {
    process.env.JWT_SECRET = JWT_SECRET;
  });

  describe("Aplicação principal", () => {
    it("deve responder na rota pública de health", async () => {
      const resposta = await request(app).get("/analise/health");

      expect(resposta.status).toBe(200);
      expect(resposta.body).toEqual({ status: "ok" });
    });
  });

  describe("Autenticação e controle de município", () => {
    it("deve retornar 401 quando não houver token", async () => {
      const resposta = await request(appTeste)
        .get("/teste/municipios");

      expect(resposta.status).toBe(401);
    });

    it("deve retornar 401 quando o token for inválido", async () => {
      const resposta = await request(appTeste)
        .get("/teste/municipios")
        .set("Authorization", "Bearer token-invalido");

      expect(resposta.status).toBe(401);
    });

    it("deve permitir que o Gestor acesse seu próprio município", async () => {
      const token = criarToken(
        PERFIS.GESTOR_PUBLICO,
        "municipio-1",
      );

      const resposta = await request(appTeste)
        .get("/teste/municipios?municipio=municipio-1")
        .set("Authorization", `Bearer ${token}`);

      expect(resposta.status).toBe(200);
      expect(resposta.body).toEqual({
        municipio: "municipio-1",
      });
    });

    it("deve retornar 404 quando o Gestor solicitar outro município", async () => {
      const token = criarToken(
        PERFIS.GESTOR_PUBLICO,
        "municipio-1",
      );

      const resposta = await request(appTeste)
        .get("/teste/municipios?municipio=municipio-2")
        .set("Authorization", `Bearer ${token}`);

      expect(resposta.status).toBe(404);
    });

    it("deve permitir que o Administrador acesse outro município", async () => {
      const token = criarToken(
        PERFIS.ADMINISTRADOR,
        null,
      );

      const resposta = await request(appTeste)
        .get("/teste/municipios?municipio=municipio-2")
        .set("Authorization", `Bearer ${token}`);

      expect(resposta.status).toBe(200);
      expect(resposta.body).toEqual({
        municipio: "municipio-2",
      });
    });
  });
});
