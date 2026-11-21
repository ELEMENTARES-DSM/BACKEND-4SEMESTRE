import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CASOS_LOTE,
  contarLeiturasEnviadas,
  lerCasos,
  planejarLote,
} from "../lote/plano.js";
import { criarRng } from "../random.js";
import type { SensorSimulado } from "../sensores.js";
import { CHUVA, CINCO_SENSORES, DIRECAO, NEBULOSIDADE, PRESSAO, TEMPERATURA_EM_KELVIN } from "./fixtures.js";

const ESTACOES = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
];

const porEstacao = (...sensores: SensorSimulado[][]) =>
  new Map(ESTACOES.map((id, i) => [id, sensores[i] ?? sensores[0]]));

const plano = (medidas = 1000, casos = [...CASOS_LOTE], sensoresPorEstacao = porEstacao(CINCO_SENSORES)) =>
  planejarLote({
    estacoes: ESTACOES,
    sensoresPorEstacao,
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
    assert.throws(
      () => planejarLote({ estacoes: [], sensoresPorEstacao: new Map(), medidas: 10, inicioUnix: 1, casos: [], rng: Math.random }),
      /estação/,
    );
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

describe("planejarLote com os sensores de cada estação (US-39)", () => {
  const chuvaEPressao = [CHUVA, PRESSAO];

  it("estação com precipitação e pressão publica as duas leituras, com os códigos dela", () => {
    const mensagens = plano(10, [], porEstacao(chuvaEPressao));

    assert.ok(mensagens.every((m) => m.leituras.map((l) => l.sensor).join() === "CHUVA-01,PRES-01"));
    assert.equal(mensagens.length, 5);
  });

  it("as leituras de chuva e pressão ficam dentro da faixa física do catálogo", () => {
    for (const m of plano(400, [], porEstacao(chuvaEPressao))) {
      const [chuva, pressao] = m.leituras;
      assert.ok(chuva.valor >= 0 && chuva.valor <= 500, `chuva ${chuva.valor}`);
      assert.ok(pressao.valor >= 600 && pressao.valor <= 1100, `pressão ${pressao.valor}`);
    }
  });

  it("estações com sensores diferentes recebem mensagens do tamanho dos seus sensores", () => {
    const mensagens = plano(1000, [], porEstacao(CINCO_SENSORES, [DIRECAO, PRESSAO, CHUVA]));
    const da = (id: string) => mensagens.filter((m) => m.estacao_uuid === id);

    assert.ok(da(ESTACOES[0]).every((m) => m.leituras.length === 5));
    assert.ok(da(ESTACOES[1]).every((m) => m.leituras.length === 3));
    assert.ok(contarLeiturasEnviadas(mensagens) >= 1000);
  });

  it("o lote fecha com o mínimo de mensagens que cobre as medidas pedidas", () => {
    const mensagens = plano(1000, [], porEstacao(CINCO_SENSORES, [DIRECAO, PRESSAO, CHUVA]));
    const semUltima = mensagens.slice(0, -1);

    assert.ok(contarLeiturasEnviadas(mensagens) >= 1000);
    assert.ok(contarLeiturasEnviadas(semUltima) < 1000);
  });

  it("sensor em Kelvin publica o bruto (cerca de 300), não o valor real em °C", () => {
    for (const m of plano(100, [], porEstacao([TEMPERATURA_EM_KELVIN]))) {
      assert.ok(m.leituras[0].valor > 280 && m.leituras[0].valor < 320, `bruto ${m.leituras[0].valor}`);
    }
  });

  it("grandeza nova do catálogo entra no lote sem mudar o código do simulador", () => {
    const mensagens = plano(40, [], porEstacao([NEBULOSIDADE]));

    assert.ok(mensagens.every((m) => m.leituras[0].sensor === "NEB-01"));
    assert.ok(mensagens.every((m) => m.leituras[0].valor >= 0 && m.leituras[0].valor <= 8));
  });

  it("umidade inválida numa estação sem sensor de umidade usa o primeiro sensor, acima da faixa", () => {
    const mensagens = plano(20, ["umidade_invalida"], porEstacao(chuvaEPressao));
    const invalida = mensagens.find((m) => m.caso === "umidade_invalida");

    assert.ok(invalida);
    assert.ok(invalida.leituras[0].valor > CHUVA.faixaMax, `valor ${invalida.leituras[0].valor}`);
  });

  it("umidade inválida com sensor em Kelvin usa a calibração invertida: real 120 vira bruto 393,15", () => {
    const umidadeEmKelvin: SensorSimulado = { ...CINCO_SENSORES[1], offset: -273.15 };
    const mensagens = plano(20, ["umidade_invalida"], porEstacao([umidadeEmKelvin]));
    const invalida = mensagens.find((m) => m.caso === "umidade_invalida");

    assert.equal(invalida?.leituras[0].valor, 393.15);
  });

  it("recusa estação sem sensor ativo, dizendo qual", () => {
    const semSensor = new Map([[ESTACOES[0], CINCO_SENSORES], [ESTACOES[1], [] as SensorSimulado[]]]);

    assert.throws(() => plano(100, [], semSensor), new RegExp(`${ESTACOES[1]} não tem sensor ativo`));
  });

  it("o tamanho mínimo do lote é o da menor mensagem", () => {
    assert.throws(() => plano(2, [], porEstacao([DIRECAO, PRESSAO, CHUVA])), /pelo menos 3 medidas/);
  });
});
