import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { criarRng } from "../random.js";
import { calibrar } from "../sensores.js";
import { gerarTelemetria } from "../telemetria.factory.js";
import { CHUVA, CINCO_SENSORES, PRESSAO, TEMPERATURA_EM_KELVIN } from "./fixtures.js";

describe("gerarTelemetria (US-39)", () => {
  it("publica uma leitura por sensor da estação, na ordem, com o código do sensor", () => {
    const payload = gerarTelemetria([CHUVA, PRESSAO], criarRng("a"));

    assert.deepEqual(payload.leituras.map((l) => l.sensor), ["CHUVA-01", "PRES-01"]);
  });

  it("estação com precipitação e pressão publica as duas dentro da faixa (critério da 39.05)", () => {
    const rng = criarRng("criterio");

    for (let i = 0; i < 500; i++) {
      const [chuva, pressao] = gerarTelemetria([CHUVA, PRESSAO], rng).leituras;

      assert.ok(chuva.valor >= 0 && chuva.valor <= 500, `chuva ${chuva.valor}`);
      assert.ok(pressao.valor >= 600 && pressao.valor <= 1100, `pressão ${pressao.valor}`);
    }
  });

  it("sensor em Kelvin publica o bruto, que a validação converte para a faixa em °C", () => {
    const rng = criarRng("k");

    for (let i = 0; i < 500; i++) {
      const [leitura] = gerarTelemetria([TEMPERATURA_EM_KELVIN], rng).leituras;
      const real = calibrar(leitura.valor, TEMPERATURA_EM_KELVIN);

      assert.ok(leitura.valor > 250, `bruto ${leitura.valor} deveria estar em Kelvin`);
      assert.ok(real >= -50 && real <= 60, `real ${real}`);
    }
  });

  it("os 5 sensores de antes continuam saindo com as 5 leituras", () => {
    const payload = gerarTelemetria(CINCO_SENSORES, criarRng("cinco"));

    assert.equal(payload.leituras.length, 5);
    assert.ok(payload.nivel_bateria !== undefined && payload.nivel_bateria >= 55 && payload.nivel_bateria <= 100);
    assert.ok(!Number.isNaN(Date.parse(payload.timestamp)));
  });

  it("sem sensores, não há leituras", () => {
    assert.deepEqual(gerarTelemetria([], criarRng("v")).leituras, []);
  });
});
