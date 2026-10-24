import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calcularBalanco, formatarBalanco, type Destinos, type StagingRow } from "../balanco.js";
import type { MensagemLote } from "../manifesto.js";

const E1 = "11111111-1111-4111-8111-111111111111";
const E2 = "22222222-2222-4222-8222-222222222222";
const DESCONHECIDA = "99999999-9999-4999-a999-999999999999";

const SENSORES = ["TEMP-01", "UMID-01", "PM25-01", "PM10-01", "VENTO-01"];

function mensagem(estacao: string, unixtime: number, caso = "valida", vezes = 1): MensagemLote {
  const leituras = SENSORES.map((sensor) => ({ sensor, valor: sensor === "UMID-01" && caso === "umidade_invalida" ? 120 : 20 }));
  const timestamp = new Date(unixtime * 1000).toISOString();
  return { estacao_uuid: estacao, timestamp, unixtime, leituras, vezes, caso, payload_bruto: JSON.stringify({ timestamp, leituras }) };
}

function staging(m: MensagemLote, status = "publicada", motivo: string | null = null): StagingRow {
  return {
    id: `st-${m.estacao_uuid.slice(0, 2)}-${m.unixtime}`,
    estacao_uuid: m.estacao_uuid,
    unixtime: status === "rejeitada" ? null : m.unixtime,
    status,
    motivo_rejeicao: motivo,
    payload_bruto: m.payload_bruto,
  };
}

// Destinos de um lote que passou inteiro pelo fluxo.
function fluxoCompleto(manifesto: MensagemLote[]): Destinos {
  const destinos: Destinos = { staging: [], medidas: [], dlq: [] };
  for (const m of manifesto) {
    if (m.estacao_uuid === DESCONHECIDA) {
      destinos.staging.push(staging(m, "rejeitada", "Estação desconhecida"));
      continue;
    }
    const linha = staging(m);
    destinos.staging.push(linha);
    if (m.caso === "sensor_inexistente") {
      destinos.medidas.push({ staging_id: linha.id, validas: 4, invalidas: 0 });
      destinos.dlq.push({ staging_id: linha.id, leituras: [{ sensor: "SENSOR-INEXISTENTE", valor: 20 }] });
    } else if (m.caso === "umidade_invalida") {
      destinos.medidas.push({ staging_id: linha.id, validas: 4, invalidas: 1 });
    } else {
      destinos.medidas.push({ staging_id: linha.id, validas: 5, invalidas: 0 });
    }
  }
  return destinos;
}

const lote = (): MensagemLote[] => [
  mensagem(E1, 1792400000),
  mensagem(E2, 1792400000),
  mensagem(E1, 1792400001, "duplicata", 2),
  mensagem(DESCONHECIDA, 1792400001, "estacao_desconhecida"),
  mensagem(E2, 1792400001, "umidade_invalida"),
  mensagem(E1, 1792400002, "sensor_inexistente"),
];

describe("calcularBalanco (US-21)", () => {
  it("cenário 1: lote que passou inteiro fecha com diferença zero", () => {
    const b = calcularBalanco(lote(), fluxoCompleto(lote()));

    assert.equal(b.enviadas, 35);
    assert.equal(b.diferenca, 0);
    assert.equal(b.emAndamento, 0);
  });

  it("cenário 3: a duplicata conta uma vez como gravada e a cópia como ignorada", () => {
    const b = calcularBalanco(lote(), fluxoCompleto(lote()));

    assert.equal(b.ignoradas, 5);
    assert.equal(b.gravadasValidas + b.gravadasInvalidas, 5 + 5 + 5 + 5 + 4);
  });

  it("cenário 4: a estação desconhecida aparece em rejeitadas com o motivo", () => {
    const b = calcularBalanco(lote(), fluxoCompleto(lote()));

    assert.equal(b.rejeitadas, 5);
    assert.deepEqual(b.rejeitadasPorMotivo, { "Estação desconhecida": 5 });
  });

  it("cenário 5: umidade 120,0 conta como gravada com valida falso", () => {
    const b = calcularBalanco(lote(), fluxoCompleto(lote()));

    assert.equal(b.gravadasInvalidas, 1);
  });

  it("leitura de sensor inexistente conta na DLQ, medida por medida", () => {
    const b = calcularBalanco(lote(), fluxoCompleto(lote()));

    assert.equal(b.dlq, 1);
  });

  it("cenário 6: medida que não aparece em nenhum destino deixa diferença diferente de zero", () => {
    const destinos = fluxoCompleto(lote());
    destinos.medidas[0] = { ...destinos.medidas[0], validas: 4 };

    const b = calcularBalanco(lote(), destinos);

    assert.equal(b.diferenca, 1);
  });

  it("mensagem que ainda não chegou ao staging também deixa diferença", () => {
    const destinos = fluxoCompleto(lote());
    destinos.staging.splice(1, 1);

    assert.equal(calcularBalanco(lote(), destinos).diferenca, 5);
  });

  it("mensagem ainda no staging (recebida ou pendente) conta como em andamento", () => {
    const destinos = fluxoCompleto(lote());
    destinos.staging[0] = { ...destinos.staging[0], status: "pendente" };

    const b = calcularBalanco(lote(), destinos);

    assert.equal(b.emAndamento, 5);
    assert.equal(b.diferenca, 5);
  });

  it("evento malformado na DLQ conta as leituras do evento original", () => {
    const m = mensagem(E1, 1792400010);
    const linha = staging(m);
    const b = calcularBalanco([m], {
      staging: [linha],
      medidas: [],
      dlq: [{ staging_id: linha.id, leituras: { staging_id: linha.id, leituras: m.leituras } }],
    });

    assert.equal(b.dlq, 5);
    assert.equal(b.diferenca, 0);
  });

  it("DLQ e staging de outros lotes não entram na conta", () => {
    const destinos = fluxoCompleto(lote());
    destinos.dlq.push({ staging_id: "de-outro-lote", leituras: [{ sensor: "X", valor: 1 }] });
    destinos.staging.push(staging(mensagem(E1, 1792300000)));

    assert.equal(calcularBalanco(lote(), destinos).diferenca, 0);
  });

  it("estação e horário já usados por outro lote não contam como deste: o balanço não fecha", () => {
    const destinos = fluxoCompleto(lote());
    // O lote anterior gravou E1 no mesmo horário com outro conteúdo; a mensagem deste foi descartada.
    const anterior = { ...staging(mensagem(E1, 1792400000)), payload_bruto: '{"de":"outro lote"}' };
    destinos.staging = destinos.staging.map((linha) => (linha.id === anterior.id ? anterior : linha));

    const b = calcularBalanco(lote(), destinos);

    assert.equal(b.gravadasValidas, 18);
    assert.equal(b.diferenca, 5);
  });

  it("o relatório mostra cada parcela e a diferença", () => {
    const texto = formatarBalanco(calcularBalanco(lote(), fluxoCompleto(lote())));

    assert.match(texto, /enviadas\.+ 35/);
    assert.match(texto, /rejeitadas\.+ 5 \(Estação desconhecida: 5\)/);
    assert.match(texto, /diferença\.+ 0/);
  });
});
