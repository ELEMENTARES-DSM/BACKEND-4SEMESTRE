import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lerValkey, macDoTopico } from "../destinos.js";
import type { MensagemLote } from "../manifesto.js";

const E1 = "11111111-1111-4111-8111-111111111111";
const MAC_E1 = "aabbccddee01";
const MAC_OUTRA = "aabbccddee03";
const topico = (mac: string) => `pulso/estacoes/${mac}/telemetria`;

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

const manifesto = [{ estacao_uuid: E1, estacao_mac: MAC_E1 }] as MensagemLote[];

describe("lerValkey", () => {
  it("deve devolver id, estação, status, motivo e conteúdo quando a mensagem é de uma estação do lote", async () => {
    // Dado
    const cliente = valkeyFalso({
      "staging:msg:a1": { topico: topico(MAC_E1), conteudo: "{}", status: "recusada", motivo: "Estação inativa" },
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
      "staging:msg:outra": { topico: topico(MAC_OUTRA), conteudo: "{}", status: "encaminhada" },
      "staging:msg:sem-uuid": { topico: "pulso/estacoes/telemetria", conteudo: "{}", status: "recusada" },
      "staging:msg:expirou": {},
    });

    // Quando
    const mensagens = await lerValkey(cliente, manifesto);

    // Então
    assert.deepEqual(mensagens, []);
  });
});

describe("macDoTopico", () => {
  it("deve devolver o MAC em minúsculas quando o tópico está no padrão", () => {
    // Dado / Quando
    const mac = macDoTopico(topico("AABBCCDDEE01"));

    // Então
    assert.equal(mac, MAC_E1);
  });

  it("deve devolver null quando o tópico está fora do padrão ou ausente", () => {
    // Dado / Quando / Então
    assert.equal(macDoTopico("pulso/estacoes/telemetria"), null);
    assert.equal(macDoTopico(null), null);
  });
});
