import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estacaoDoTopico, lerValkey } from "../destinos.js";
import type { MensagemLote } from "../manifesto.js";

const E1 = "11111111-1111-4111-8111-111111111111";
const OUTRA = "33333333-3333-4333-8333-333333333333";
const topico = (estacao: string) => `pulso/estacoes/${estacao}/telemetria`;

// Valkey falso: staging:msg:{id} → campos do hash (topico, conteudo, status, motivo).
function valkeyFalso(hashes: Record<string, Record<string, string>>) {
  return {
    async *scanIterator() {
      yield* Object.keys(hashes);
    },
    async hmGet(chave: string, campos: string[]) {
      return campos.map((campo) => hashes[chave]?.[campo] ?? null);
    },
  } as unknown as Parameters<typeof lerValkey>[0];
}

const manifesto = [{ estacao_uuid: E1 }] as MensagemLote[];

describe("lerValkey", () => {
  it("deve devolver id, estação, status, motivo e conteúdo quando a mensagem é de uma estação do lote", async () => {
    // Dado
    const cliente = valkeyFalso({
      "staging:msg:a1": { topico: topico(E1), conteudo: "{}", status: "recusada", motivo: "Estação inativa" },
    });

    // Quando
    const mensagens = await lerValkey(cliente, manifesto);

    // Então
    assert.deepEqual(mensagens, [
      { id: "a1", estacao_uuid: E1, status: "recusada", motivo: "Estação inativa", payload_bruto: "{}" },
    ]);
  });

  it("deve deixar de fora outra estação, tópico fora do padrão e chave que expirou quando lê o Valkey", async () => {
    // Dado
    const cliente = valkeyFalso({
      "staging:msg:outra": { topico: topico(OUTRA), conteudo: "{}", status: "encaminhada" },
      "staging:msg:sem-uuid": { topico: "pulso/estacoes/telemetria", conteudo: "{}", status: "recusada" },
      "staging:msg:expirou": {},
    });

    // Quando
    const mensagens = await lerValkey(cliente, manifesto);

    // Então
    assert.deepEqual(mensagens, []);
  });
});

describe("estacaoDoTopico", () => {
  it("deve devolver o UUID quando o tópico está no padrão", () => {
    // Dado / Quando
    const estacao = estacaoDoTopico(topico(E1));

    // Então
    assert.equal(estacao, E1);
  });

  it("deve devolver null quando o tópico está fora do padrão ou ausente", () => {
    // Dado / Quando / Então
    assert.equal(estacaoDoTopico("pulso/estacoes/telemetria"), null);
    assert.equal(estacaoDoTopico(null), null);
  });
});
