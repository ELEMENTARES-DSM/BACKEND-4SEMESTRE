import { describe, it, expect } from "@jest/globals";
import { ehBancoIndisponivel } from "../../utils/erro-banco";

const erro = (message: string, code?: string) => Object.assign(new Error(message), { code });

describe("ehBancoIndisponivel (US-20)", () => {
  it.each([
    ["conexão recusada", erro("connect ECONNREFUSED 127.0.0.1:5432", "ECONNREFUSED")],
    ["conexão derrubada", erro("read ECONNRESET", "ECONNRESET")],
    ["host não encontrado", erro("getaddrinfo ENOTFOUND postgres", "ENOTFOUND")],
    ["tempo esgotado na rede", erro("connect ETIMEDOUT", "ETIMEDOUT")],
    ["tempo esgotado do pool", erro("timeout exceeded when trying to connect")],
    ["conexão encerrada no meio da consulta", erro("Connection terminated unexpectedly")],
    ["servidor desligando (57P01)", erro("terminating connection due to administrator command", "57P01")],
    ["servidor iniciando (57P03)", erro("the database system is starting up", "57P03")],
    ["falha de conexão (08006)", erro("connection failure", "08006")],
  ])("%s é banco indisponível", (_caso, e) => {
    expect(ehBancoIndisponivel(e)).toBe(true);
  });

  it.each([
    ["estouro numérico do próprio evento (22003)", erro("numeric field overflow", "22003")],
    ["violação de chave estrangeira (23503)", erro("insert or update violates foreign key", "23503")],
    ["erro genérico", new Error("Falha inesperada")],
    ["valor que não é erro", "texto"],
    ["nulo", null],
  ])("%s não é banco indisponível", (_caso, e) => {
    expect(ehBancoIndisponivel(e)).toBe(false);
  });
});
