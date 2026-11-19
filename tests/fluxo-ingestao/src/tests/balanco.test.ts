import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calcularBalanco, formatarBalanco, type Destinos, type MensagemStaging } from "../balanco.js";
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

// Uma cópia da mensagem no Valkey; a n-ésima cópia ganha outro id.
function staging(m: MensagemLote, status = "encaminhada", motivo: string | null = null, copia = 0): MensagemStaging {
  return {
    id: `st-${m.estacao_uuid.slice(0, 2)}-${m.unixtime}-${copia}`,
    estacao_uuid: m.estacao_uuid,
    status,
    motivo,
    payload_bruto: m.payload_bruto,
  };
}

// Destinos de um lote que passou inteiro pelo fluxo.
function fluxoCompleto(manifesto: MensagemLote[]): Destinos {
  const destinos: Destinos = { staging: [], medidas: [], dlq: [] };
  for (const m of manifesto) {
    if (m.estacao_uuid === DESCONHECIDA) {
      destinos.staging.push(staging(m, "recusada", "Estação desconhecida"));
      continue;
    }
    const encaminhada = staging(m);
    destinos.staging.push(encaminhada);
    for (let copia = 1; copia < m.vezes; copia++) {
      destinos.staging.push(staging(m, "duplicada", null, copia));
    }
    if (m.caso === "sensor_inexistente") {
      destinos.medidas.push({ staging_id: encaminhada.id, validas: 4, invalidas: 0 });
      destinos.dlq.push({ staging_id: encaminhada.id, leituras: [{ sensor: "SENSOR-INEXISTENTE", valor: 20 }] });
    } else if (m.caso === "umidade_invalida") {
      destinos.medidas.push({ staging_id: encaminhada.id, validas: 4, invalidas: 1 });
    } else {
      destinos.medidas.push({ staging_id: encaminhada.id, validas: 5, invalidas: 0 });
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

describe("calcularBalanco (US-21, lendo o Valkey)", () => {
  it("deve fechar com diferença zero quando o lote passou inteiro pelo fluxo", () => {
    // Dado
    const destinos = fluxoCompleto(lote());

    // Quando
    const b = calcularBalanco(lote(), destinos);

    // Então
    assert.equal(b.enviadas, 35);
    assert.equal(b.diferenca, 0);
    assert.equal(b.emAndamento, 0);
  });

  it("deve contar a encaminhada como gravada e a cópia duplicada no Valkey como ignorada quando a leitura chega 2 vezes", () => {
    // Dado
    const destinos = fluxoCompleto(lote());

    // Quando
    const b = calcularBalanco(lote(), destinos);

    // Então
    assert.equal(b.ignoradas, 5);
    assert.equal(b.gravadasValidas + b.gravadasInvalidas, 5 + 5 + 5 + 5 + 4);
  });

  it("deve deixar diferença quando a cópia de uma duplicata não chegou ao Valkey", () => {
    // Dado
    const destinos = fluxoCompleto(lote());
    destinos.staging = destinos.staging.filter((m) => m.status !== "duplicada");

    // Quando
    const b = calcularBalanco(lote(), destinos);

    // Então
    assert.equal(b.ignoradas, 0);
    assert.equal(b.diferenca, 5);
  });

  it("deve contar no máximo vezes - 1 cópias como ignoradas quando o broker reentrega a mesma mensagem", () => {
    // Dado
    const m = mensagem(E1, 1792400020, "duplicata", 2);
    const destinos = fluxoCompleto([m]);
    destinos.staging.push(staging(m, "duplicada", null, 2));

    // Quando
    const b = calcularBalanco([m], destinos);

    // Então
    assert.equal(b.ignoradas, 5);
    assert.equal(b.diferenca, 0);
  });

  it("deve mostrar a estação desconhecida em rejeitadas com o motivo do Valkey quando ela é recusada", () => {
    // Dado
    const destinos = fluxoCompleto(lote());

    // Quando
    const b = calcularBalanco(lote(), destinos);

    // Então
    assert.equal(b.rejeitadas, 5);
    assert.deepEqual(b.rejeitadasPorMotivo, { "Estação desconhecida": 5 });
  });

  it("deve contar como gravada com valida falso quando a umidade é 120,0", () => {
    // Dado
    const destinos = fluxoCompleto(lote());

    // Quando
    const b = calcularBalanco(lote(), destinos);

    // Então
    assert.equal(b.gravadasInvalidas, 1);
  });

  it("deve contar na DLQ, medida por medida, quando o sensor não existe", () => {
    // Dado
    const destinos = fluxoCompleto(lote());

    // Quando
    const b = calcularBalanco(lote(), destinos);

    // Então
    assert.equal(b.dlq, 1);
  });

  it("deve deixar diferença diferente de zero quando uma medida não aparece em nenhum destino", () => {
    // Dado
    const destinos = fluxoCompleto(lote());
    destinos.medidas[0] = { ...destinos.medidas[0], validas: 4 };

    // Quando
    const b = calcularBalanco(lote(), destinos);

    // Então
    assert.equal(b.diferenca, 1);
  });

  it("deve deixar diferença quando a mensagem não chegou ao Valkey", () => {
    // Dado
    const destinos = fluxoCompleto(lote());
    destinos.staging.splice(1, 1);

    // Quando
    const b = calcularBalanco(lote(), destinos);

    // Então
    assert.equal(b.diferenca, 5);
  });

  it("deve contar como em andamento quando uma cópia ainda está recebida ou pendente", () => {
    // Dado
    const destinos = fluxoCompleto(lote());
    destinos.staging[0] = { ...destinos.staging[0], status: "pendente" };
    const copiaRecebida = staging(lote()[2], "recebida", null, 1);
    destinos.staging = destinos.staging.map((m) => (m.id === copiaRecebida.id ? copiaRecebida : m));

    // Quando
    const b = calcularBalanco(lote(), destinos);

    // Então
    assert.equal(b.emAndamento, 10);
    assert.equal(b.diferenca, 15);
  });

  it("deve contar as leituras do evento original quando o evento malformado está na DLQ", () => {
    // Dado
    const m = mensagem(E1, 1792400010);
    const encaminhada = staging(m);
    const destinos: Destinos = {
      staging: [encaminhada],
      medidas: [],
      dlq: [{ staging_id: encaminhada.id, leituras: { staging_id: encaminhada.id, leituras: m.leituras } }],
    };

    // Quando
    const b = calcularBalanco([m], destinos);

    // Então
    assert.equal(b.dlq, 5);
    assert.equal(b.diferenca, 0);
  });

  it("deve ignorar DLQ e mensagens do Valkey de outros lotes quando fecha o balanço", () => {
    // Dado
    const destinos = fluxoCompleto(lote());
    destinos.dlq.push({ staging_id: "de-outro-lote", leituras: [{ sensor: "X", valor: 1 }] });
    destinos.staging.push(staging(mensagem(E1, 1792300000)));

    // Quando
    const b = calcularBalanco(lote(), destinos);

    // Então
    assert.equal(b.diferenca, 0);
  });

  it("deve não fechar quando estação e horário já foram usados por outro lote e a deste ficou só duplicada", () => {
    // Dado
    const destinos = fluxoCompleto(lote());
    // O lote anterior foi encaminhado com outro conteúdo; a deste virou duplicada.
    const desteLote = destinos.staging.find((m) => m.estacao_uuid === E1 && m.payload_bruto === lote()[0].payload_bruto);
    assert.ok(desteLote);
    desteLote.status = "duplicada";

    // Quando
    const b = calcularBalanco(lote(), destinos);

    // Então
    assert.equal(b.gravadasValidas, 18);
    assert.equal(b.ignoradas, 5);
    assert.equal(b.diferenca, 5);
  });

  it("deve mostrar cada parcela e a diferença quando formata o relatório", () => {
    // Dado
    const b = calcularBalanco(lote(), fluxoCompleto(lote()));

    // Quando
    const texto = formatarBalanco(b);

    // Então
    assert.match(texto, /enviadas\.+ 35/);
    assert.match(texto, /rejeitadas\.+ 5 \(Estação desconhecida: 5\)/);
    assert.match(texto, /diferença\.+ 0/);
  });
});
