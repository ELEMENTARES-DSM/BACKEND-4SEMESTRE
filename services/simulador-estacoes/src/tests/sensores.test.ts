import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { criarRng } from "../random.js";
import {
  brutoParaAlvo,
  calibrar,
  converterSensor,
  faixaDeSorteio,
  gerarLeituraBruta,
  gerarLeituraForaDaFaixa,
  type SensorSimulado,
} from "../sensores.js";
import {
  CHUVA,
  CINCO_SENSORES,
  daApi,
  DIRECAO,
  NEBULOSIDADE,
  PRESSAO,
  simulado,
  TEMPERATURA_EM_KELVIN,
} from "./fixtures.js";

const SORTEIOS = 2000;

/** Sorteia muitas leituras e devolve o valor real que a validação calcularia para cada uma. */
const valoresReais = (sensor: SensorSimulado, semente = "sensores"): number[] => {
  const rng = criarRng(semente);
  return Array.from({ length: SORTEIOS }, () => calibrar(gerarLeituraBruta(sensor, rng), sensor));
};

describe("gerarLeituraBruta: valor real dentro da faixa da grandeza (US-39)", () => {
  for (const sensor of [...CINCO_SENSORES, CHUVA, PRESSAO, DIRECAO, TEMPERATURA_EM_KELVIN, NEBULOSIDADE]) {
    it(`${sensor.tipo} (${sensor.codigo}): o valor real nunca sai de ${sensor.faixaMin} a ${sensor.faixaMax} ${sensor.unidade}`, () => {
      for (const real of valoresReais(sensor)) {
        assert.ok(
          real >= sensor.faixaMin && real <= sensor.faixaMax,
          `${sensor.codigo}: real ${real} fora de ${sensor.faixaMin} a ${sensor.faixaMax}`,
        );
      }
    });
  }

  it("precipitação e pressão saem em faixas realistas, não em toda a faixa física", () => {
    const chuva = valoresReais(CHUVA);
    const pressao = valoresReais(PRESSAO);

    assert.ok(Math.max(...chuva) <= 30, "chuva acima de 30 mm");
    assert.ok(Math.min(...pressao) >= 980 && Math.max(...pressao) <= 1040, "pressão fora de 980 a 1040 hPa");
  });

  it("grandeza nova, fora da tabela do simulador, usa a faixa física com folga nas pontas", () => {
    const reais = valoresReais(NEBULOSIDADE);

    assert.deepEqual(faixaDeSorteio(NEBULOSIDADE), [0.4, 7.6]);
    assert.ok(Math.min(...reais) >= 0.35 && Math.max(...reais) <= 7.65);
    assert.ok(Math.max(...reais) - Math.min(...reais) > 5, "a grandeza nova deveria usar a faixa toda");
  });

  it("os 5 sensores de antes mantêm as faixas realistas de antes", () => {
    const esperado: Record<string, [number, number]> = {
      "TEMP-01": [15, 38],
      "UMID-01": [25, 95],
      "PM25-01": [0, 150],
      "PM10-01": [0, 200],
      "VENTO-01": [0, 50],
    };

    for (const sensor of CINCO_SENSORES) {
      assert.deepEqual(faixaDeSorteio(sensor), esperado[sensor.codigo], sensor.codigo);
    }
  });

  it("com a mesma semente, a mesma sequência", () => {
    assert.deepEqual(valoresReais(CHUVA, "x"), valoresReais(CHUVA, "x"));
  });

  it("a faixa realista é cortada pela faixa física quando o Administrador a reduz", () => {
    // Temperatura típica é 15 a 38, mas o catálogo agora limita a 20 a 30.
    const reduzida = simulado("TEMP-01", "Temperatura", "°C", 20, 30);

    assert.deepEqual(faixaDeSorteio(reduzida), [20, 30]);
    for (const real of valoresReais(reduzida)) {
      assert.ok(real >= 20 && real <= 30);
    }
  });

  it("faixa realista fora da faixa física cai para a faixa física com folga", () => {
    // Pressão típica 980 a 1040, mas o catálogo agora diz 1100 a 1200: sem interseção.
    const deslocada = simulado("PRES-01", "Pressão Atmosférica", "hPa", 1100, 1200);

    assert.deepEqual(faixaDeSorteio(deslocada), [1105, 1195]);
  });
});

describe("inversão da calibração (US-39)", () => {
  it("Kelvin: valor real 26,85 °C exige bruto 300 (bruto = (alvo - offset) / fator)", () => {
    assert.equal(brutoParaAlvo(26.85, TEMPERATURA_EM_KELVIN), 300);
    assert.equal(calibrar(300, TEMPERATURA_EM_KELVIN), 26.85);
  });

  it("sensor em Kelvin publica valores em torno de 288 a 311 K, não de 15 a 38", () => {
    const rng = criarRng("kelvin");

    for (let i = 0; i < SORTEIOS; i++) {
      const bruto = gerarLeituraBruta(TEMPERATURA_EM_KELVIN, rng);
      assert.ok(bruto >= 288.15 && bruto <= 311.15, `bruto ${bruto}`);
    }
  });

  it("fator diferente de 1: bruto 512 com fator 0,1 vale 51,2", () => {
    const decimo = simulado("UMID-02", "Umidade Relativa", "%", 0, 100, { fatorConversao: 0.1 });

    assert.equal(brutoParaAlvo(51.2, decimo), 512);
    assert.equal(calibrar(512, decimo), 51.2);
  });

  it("fator e offset juntos fecham a conta nos dois sentidos", () => {
    const sensor = simulado("X-01", "Temperatura", "°C", -50, 60, { fatorConversao: 1.005, offset: -0.025 });

    for (const alvo of [-40, 0, 12.34, 55]) {
      assert.ok(Math.abs(calibrar(brutoParaAlvo(alvo, sensor), sensor) - alvo) <= 0.02, `alvo ${alvo}`);
    }
  });

  it("calibração identidade mantém 1 casa decimal, como antes", () => {
    const rng = criarRng("casas");

    for (let i = 0; i < 200; i++) {
      const bruto = gerarLeituraBruta(CINCO_SENSORES[0], rng);
      assert.equal(bruto, Number(bruto.toFixed(1)));
    }
  });
});

describe("gerarLeituraForaDaFaixa", () => {
  it("umidade 120 de valor real vira bruto 120 com calibração identidade", () => {
    assert.equal(gerarLeituraForaDaFaixa(CINCO_SENSORES[1], 120), 120);
  });

  it("sem alvo, o valor real fica acima da faixa máxima (inclusive com faixa negativa)", () => {
    const negativa = simulado("N-01", "Frio", "°C", -80, -10);

    assert.ok(calibrar(gerarLeituraForaDaFaixa(CHUVA), CHUVA) > CHUVA.faixaMax);
    assert.ok(calibrar(gerarLeituraForaDaFaixa(negativa), negativa) > negativa.faixaMax);
  });

  it("mantém o valor fora da faixa também com a calibração do Kelvin", () => {
    const bruto = gerarLeituraForaDaFaixa(TEMPERATURA_EM_KELVIN);

    assert.ok(calibrar(bruto, TEMPERATURA_EM_KELVIN) > 60);
  });
});

describe("converterSensor", () => {
  it("converte os números que a API devolve como texto", () => {
    const sensor = converterSensor(
      daApi("TEMP-K", "Temperatura", "°C", -50, 60, { offset: "-273.150000", fator_conversao: "1.000000" }),
    );

    assert.deepEqual(sensor, {
      codigo: "TEMP-K",
      tipo: "Temperatura",
      unidade: "°C",
      faixaMin: -50,
      faixaMax: 60,
      fatorConversao: 1,
      offset: -273.15,
    });
  });

  it("recusa fator zero (não dá para inverter) e faixa invertida ou inválida", () => {
    assert.equal(converterSensor(daApi("A", "T", "u", 0, 10, { fator_conversao: "0.000000" })), null);
    assert.equal(converterSensor(daApi("A", "T", "u", 10, 10)), null);
    assert.equal(converterSensor(daApi("A", "T", "u", 10, 5)), null);
    assert.equal(converterSensor(daApi("A", "T", "u", 0, 10, { offset: "abc" })), null);
  });
});
