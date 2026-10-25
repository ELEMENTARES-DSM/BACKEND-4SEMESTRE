import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { lerManifesto, proximoInicio, resolverCaminhoManifesto } from "../manifesto.js";

const pasta = mkdtempSync(join(tmpdir(), "manifesto-"));

function arquivo(nome: string, conteudo: string): string {
  const caminho = join(pasta, nome);
  writeFileSync(caminho, conteudo, "utf-8");
  return caminho;
}

const linha = (unixtime: number) =>
  JSON.stringify({
    estacao_uuid: "11111111-1111-4111-8111-111111111111",
    timestamp: new Date(unixtime * 1000).toISOString(),
    unixtime,
    leituras: [{ sensor: "TEMP-01", valor: 20 }],
    vezes: 1,
    caso: "valida",
    payload_bruto: "{}",
  });

describe("lerManifesto (US-21)", () => {
  it("lê uma mensagem por linha, aceitando CRLF e linha em branco no fim", () => {
    const m = lerManifesto(arquivo("ok.jsonl", `${linha(10)}\r\n${linha(11)}\r\n\r\n`));

    assert.equal(m.length, 2);
    assert.equal(proximoInicio(m), 12);
  });

  it("recusa manifesto vazio ou fora do formato", () => {
    assert.throws(() => lerManifesto(arquivo("vazio.jsonl", "\n")), /Manifesto vazio/);
    assert.throws(() => lerManifesto(arquivo("ruim.jsonl", '{"estacao_uuid":"x"}\n')), /Linha 1 do manifesto/);
  });
});

describe("resolverCaminhoManifesto (US-21)", () => {
  const relativo = join("tests", "fluxo-ingestao", "saida", "lote-1.jsonl");

  it("caminho relativo vale a partir de onde o npm foi chamado, não da pasta do pacote", () => {
    const raiz = join(pasta, "backend");
    const pacote = join(raiz, "tests", "fluxo-ingestao");

    assert.equal(resolverCaminhoManifesto(relativo, { INIT_CWD: raiz }, pacote), join(raiz, relativo));
  });

  it("sem npm (INIT_CWD vazio) usa a pasta atual; caminho absoluto fica como está", () => {
    assert.equal(resolverCaminhoManifesto(relativo, {}, pasta), join(pasta, relativo));
    const absoluto = join(pasta, "lote-2.jsonl");
    assert.equal(resolverCaminhoManifesto(absoluto, { INIT_CWD: tmpdir() }, tmpdir()), absoluto);
  });
});
