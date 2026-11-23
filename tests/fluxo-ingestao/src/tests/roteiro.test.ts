import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import {
  assinarJwt,
  esperarAte,
  eventoRecusadoDoSensor,
  payloadTelemetria,
  SENSOR_INEXISTENTE,
  topicoTelemetria,
  type EventoDlqRecusado,
} from "../grandeza-nova/roteiro.js";

const ESTACAO = "f1000000-0000-4000-8000-000000000010";
const MAC = "a0a0a000000a";

describe("payloadTelemetria e topicoTelemetria (US-39)", () => {
  it("monta o payload da placa com uma leitura e o horário em ISO", () => {
    const payload = JSON.parse(payloadTelemetria("DIR-E2E", 270, 1792400000));

    assert.deepEqual(payload.leituras, [{ sensor: "DIR-E2E", valor: 270 }]);
    assert.equal(payload.timestamp, "2026-10-19T08:53:20.000Z");
    assert.equal(Math.floor(Date.parse(payload.timestamp) / 1000), 1792400000);
    assert.ok(payload.nivel_bateria >= 0 && payload.nivel_bateria <= 100);
  });

  it("publica no tópico da estação", () => {
    assert.equal(topicoTelemetria(MAC), `pulso/estacoes/${MAC}/telemetria`);
  });
});

describe("eventoRecusadoDoSensor", () => {
  const recusa = (extras: Partial<EventoDlqRecusado> = {}): EventoDlqRecusado => ({
    estacao_uuid: ESTACAO,
    leituras: [{ sensor: "DIR-E2E", valor: 270 }],
    motivo: SENSOR_INEXISTENTE,
    ...extras,
  });

  it("acha a recusa por sensor inexistente da estação e do código", () => {
    const alvo = recusa();

    assert.equal(eventoRecusadoDoSensor([recusa({ estacao_uuid: "outra" }), alvo], ESTACAO, "DIR-E2E"), alvo);
  });

  it("ignora outro sensor, outra estação, outro motivo e evento malformado", () => {
    const eventos = [
      recusa({ leituras: [{ sensor: "TEMP-01", valor: 1 }] }),
      recusa({ estacao_uuid: "outra" }),
      recusa({ motivo: "Evento malformado" }),
      recusa({ estacao_uuid: null, leituras: { qualquer: "coisa" } }),
    ];

    assert.equal(eventoRecusadoDoSensor(eventos, ESTACAO, "DIR-E2E"), undefined);
  });

  it("acha o sensor entre várias leituras da mesma mensagem", () => {
    const alvo = recusa({ leituras: [{ sensor: "A", valor: 1 }, { sensor: "DIR-E2E", valor: 270 }] });

    assert.equal(eventoRecusadoDoSensor([alvo], ESTACAO, "DIR-E2E"), alvo);
  });
});

describe("assinarJwt", () => {
  it("gera um HS256 com as claims, iat e exp, que confere com o segredo", () => {
    const token = assinarJwt({ id: "u1", papel: "ADMINISTRADOR" }, "segredo", 1_700_000_000_000, 300);
    const [cabecalho, corpo, assinatura] = token.split(".");
    const esperada = createHmac("sha256", "segredo").update(`${cabecalho}.${corpo}`).digest("base64url");

    assert.equal(assinatura, esperada);
    assert.deepEqual(JSON.parse(Buffer.from(cabecalho, "base64url").toString()), { alg: "HS256", typ: "JWT" });
    assert.deepEqual(JSON.parse(Buffer.from(corpo, "base64url").toString()), {
      id: "u1",
      papel: "ADMINISTRADOR",
      iat: 1_700_000_000,
      exp: 1_700_000_300,
    });
  });

  it("com outro segredo a assinatura muda", () => {
    const a = assinarJwt({ id: "u1" }, "um", 1_700_000_000_000);
    const b = assinarJwt({ id: "u1" }, "dois", 1_700_000_000_000);

    assert.notEqual(a.split(".")[2], b.split(".")[2]);
  });
});

describe("esperarAte", () => {
  it("devolve assim que a consulta traz algo, sem dormir", async () => {
    let dormiu = 0;

    const valor = await esperarAte(async () => "achou", "algo", { dormir: async () => void dormiu++ });

    assert.equal(valor, "achou");
    assert.equal(dormiu, 0);
  });

  it("repete até aparecer e aceita 0 e texto vazio como resposta válida", async () => {
    let chamadas = 0;

    const valor = await esperarAte(
      async () => (++chamadas < 3 ? undefined : 0),
      "zero",
      { dormir: async () => undefined, intervaloMs: 1 },
    );

    assert.equal(valor, 0);
    assert.equal(chamadas, 3);
  });

  it("falha dizendo o que esperava quando o tempo acaba", async () => {
    let agora = 0;

    await assert.rejects(
      esperarAte(async () => false, "a medida do sensor DIR-E2E", {
        limiteMs: 3000,
        intervaloMs: 1000,
        relogio: () => agora,
        dormir: async (ms) => void (agora += ms),
      }),
      /Tempo esgotado \(3 s\) esperando: a medida do sensor DIR-E2E/,
    );
  });
});
