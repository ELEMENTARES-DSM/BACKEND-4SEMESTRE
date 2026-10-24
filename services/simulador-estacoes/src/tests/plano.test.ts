import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CASOS_LOTE,
  contarLeiturasEnviadas,
  lerCasos,
  planejarLote,
} from "../lote/plano.js";
import { criarRng } from "../random.js";

const ESTACOES = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
];

const plano = (medidas = 1000, casos = [...CASOS_LOTE]) =>
  planejarLote({
    estacoes: ESTACOES,
    medidas,
    inicioUnix: 1792400000,
    casos,
    rng: criarRng("teste"),
  });

describe("planejarLote (US-21)", () => {
  it("1.000 medidas viram 200 mensagens de 5 leituras", () => {
    const mensagens = plano();

    assert.equal(mensagens.length, 200);
    assert.ok(mensagens.every((m) => m.leituras.length === 5));
  });

  it("cada estação tem horários únicos, de 1 em 1 segundo a partir do início", () => {
    const mensagens = plano(1000, []);

    for (const estacao of ESTACOES) {
      const horarios = mensagens.filter((m) => m.estacao_uuid === estacao).map((m) => m.unixtime);
      assert.equal(new Set(horarios).size, horarios.length);
      assert.deepEqual(horarios, horarios.map((_, i) => 1792400000 + i));
    }
  });

  it("o payload publicado tem o mesmo horário e as mesmas leituras do manifesto", () => {
    for (const m of plano()) {
      const payload = JSON.parse(m.payload_bruto);
      assert.equal(payload.timestamp, m.timestamp);
      assert.equal(Math.floor(Date.parse(payload.timestamp) / 1000), m.unixtime);
      assert.deepEqual(payload.leituras, m.leituras);
      assert.ok(payload.nivel_bateria >= 0 && payload.nivel_bateria <= 100);
    }
  });

  it("inclui um de cada caso especial, sem mudar o total de mensagens", () => {
    const mensagens = plano();
    const casos = mensagens.filter((m) => m.caso !== "valida").map((m) => m.caso);

    assert.deepEqual(casos, [...CASOS_LOTE]);
    assert.equal(mensagens.length, 200);
  });

  it("a duplicata sai duas vezes e conta as duas cópias nas leituras enviadas", () => {
    const mensagens = plano();
    const duplicata = mensagens.find((m) => m.caso === "duplicata");

    assert.equal(duplicata?.vezes, 2);
    assert.equal(contarLeiturasEnviadas(mensagens), 1000 + 5);
  });

  it("estação desconhecida usa um UUID que não está no lote", () => {
    const desconhecida = plano().find((m) => m.caso === "estacao_desconhecida");

    assert.ok(desconhecida);
    assert.ok(!ESTACOES.includes(desconhecida.estacao_uuid));
    assert.match(desconhecida.estacao_uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("umidade inválida manda UMID-01 com 120,0 e sensor inexistente troca a primeira leitura", () => {
    const mensagens = plano();
    const umidade = mensagens.find((m) => m.caso === "umidade_invalida");
    const inexistente = mensagens.find((m) => m.caso === "sensor_inexistente");

    assert.deepEqual(umidade?.leituras.find((l) => l.sensor === "UMID-01"), { sensor: "UMID-01", valor: 120 });
    assert.equal(inexistente?.leituras[0].sensor, "SENSOR-INEXISTENTE");
  });

  it("as leituras válidas ficam dentro das faixas plausíveis do simulador", () => {
    const validas = plano(1000, []);

    for (const m of validas) {
      for (const leitura of m.leituras) {
        assert.ok(leitura.valor >= 0 && leitura.valor <= 200, `${leitura.sensor}=${leitura.valor}`);
      }
    }
  });

  it("com a mesma semente, o lote é o mesmo", () => {
    assert.deepEqual(plano(), plano());
  });

  it("medidas que não fecham mensagem inteira arredondam para cima", () => {
    assert.equal(plano(12, []).length, 3);
  });

  it("recusa lote sem estação, pequeno demais ou com menos de uma mensagem", () => {
    assert.throws(() => planejarLote({ estacoes: [], medidas: 10, inicioUnix: 1, casos: [], rng: Math.random }), /estação/);
    assert.throws(() => plano(4, []), /pelo menos 5 medidas/);
    assert.throws(() => plano(10, [...CASOS_LOTE]), /pequeno demais/);
  });
});

describe("lerCasos", () => {
  it("vazio liga todos os casos e uma lista liga só os listados", () => {
    assert.deepEqual(lerCasos(undefined), [...CASOS_LOTE]);
    assert.deepEqual(lerCasos("duplicata, umidade_invalida"), ["duplicata", "umidade_invalida"]);
    assert.deepEqual(lerCasos(""), []);
  });

  it("recusa caso desconhecido", () => {
    assert.throws(() => lerCasos("duplicata,chuva"), /Caso desconhecido em LOTE_CASOS: "chuva"/);
  });
});
