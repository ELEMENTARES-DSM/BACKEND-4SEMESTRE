import { agruparCodigosDetectados } from "../../services/codigos-detectados";
import { MensagemVerificada } from "../../repositories/staging-valkey.repository";

const DESDE = new Date("2026-11-10T18:00:00.000Z");

const mensagem = (timestamp: string, leituras: unknown, recebidoEm = timestamp): MensagemVerificada => ({
  payloadBruto: JSON.stringify({ timestamp, leituras }),
  recebidoEm,
});

const agrupar = (mensagens: MensagemVerificada[], registrados: string[] = [], limite = 50) =>
  agruparCodigosDetectados(mensagens, registrados, DESDE, limite);

describe("agruparCodigosDetectados (US-39)", () => {
  it("deve contar as leituras de cada código e guardar o último valor e horário", () => {
    // Dado
    const mensagens = [
      mensagem("2026-11-17T10:00:00.000Z", [{ sensor: "PM25", valor: 10 }]),
      mensagem("2026-11-17T10:02:00.000Z", [{ sensor: "PM25", valor: 14 }]),
      mensagem("2026-11-17T10:01:00.000Z", [{ sensor: "PM25", valor: 12 }]),
    ];

    // Quando
    const resultado = agrupar(mensagens);

    // Então: o último é o de horário mais recente, não o último da lista.
    expect(resultado).toEqual([
      { codigo: "PM25", total: 3, ultimo_valor: 14, ultima_leitura_em: "2026-11-17T10:02:00.000Z" },
    ]);
  });

  it("deve ordenar do código lido mais recentemente para o mais antigo, e por código no empate", () => {
    // Dado
    const mensagens = [
      mensagem("2026-11-17T10:00:00.000Z", [{ sensor: "B", valor: 1 }, { sensor: "A", valor: 1 }]),
      mensagem("2026-11-17T11:00:00.000Z", [{ sensor: "Z", valor: 1 }]),
    ];

    // Quando
    const resultado = agrupar(mensagens);

    // Então
    expect(resultado.map((d) => d.codigo)).toEqual(["Z", "A", "B"]);
  });

  it("deve tirar os códigos já cadastrados na estação, comparando exatamente", () => {
    // Dado
    const mensagens = [mensagem("2026-11-17T10:00:00.000Z", [
      { sensor: "PM25", valor: 1 },
      { sensor: "pm10", valor: 1 },
    ])];

    // Quando: PM10 em maiúsculas está cadastrado, mas a placa manda "pm10".
    const resultado = agrupar(mensagens, ["PM25", "PM10"]);

    // Então: o descompasso aparece na lista.
    expect(resultado.map((d) => d.codigo)).toEqual(["pm10"]);
  });

  it("deve ignorar mensagem de antes da janela, usando o timestamp do payload", () => {
    // Dado: chegou agora à ingestão, mas a leitura é de 12 dias atrás.
    const antiga = mensagem("2026-11-05T10:00:00.000Z", [{ sensor: "ANTIGO", valor: 1 }], "2026-11-17T10:00:00.000Z");

    // Quando / Então
    expect(agrupar([antiga])).toEqual([]);
  });

  it("deve usar o horário de chegada quando o payload não traz um timestamp válido", () => {
    // Dado
    const semHorario: MensagemVerificada = {
      payloadBruto: JSON.stringify({ timestamp: "ontem", leituras: [{ sensor: "PM25", valor: 3 }] }),
      recebidoEm: "2026-11-17T09:00:00.000Z",
    };

    // Quando
    const resultado = agrupar([semHorario]);

    // Então
    expect(resultado).toEqual([
      { codigo: "PM25", total: 1, ultimo_valor: 3, ultima_leitura_em: "2026-11-17T09:00:00.000Z" },
    ]);
  });

  it("deve pular a mensagem sem horário nenhum", () => {
    // Dado
    const semNada: MensagemVerificada = {
      payloadBruto: JSON.stringify({ leituras: [{ sensor: "PM25", valor: 3 }] }),
      recebidoEm: "isso não é uma data",
    };

    // Quando / Então
    expect(agrupar([semNada])).toEqual([]);
  });

  it("deve oferecer só código que dá para cadastrar (1 a 30 caracteres, sem espaço nas pontas)", () => {
    // Dado
    const leituras = [
      { sensor: "", valor: 1 },
      { sensor: " PM25", valor: 1 },
      { sensor: "PM10 ", valor: 1 },
      { sensor: "X".repeat(31), valor: 1 },
      { sensor: "X".repeat(30), valor: 1 },
      { sensor: "PM 2.5", valor: 1 },
    ];

    // Quando
    const resultado = agrupar([mensagem("2026-11-17T10:00:00.000Z", leituras)]);

    // Então
    expect(resultado.map((d) => d.codigo).sort()).toEqual(["PM 2.5", "X".repeat(30)].sort());
  });

  it("deve pular item mal formado sem derrubar o resto da mensagem", () => {
    // Dado: número no lugar do código (42) não vira o código "42".
    const leituras = [42, null, "PM25", [], { sensor: 42, valor: 1 }, { valor: 1 }, { sensor: "OK", valor: 7 }];

    // Quando
    const resultado = agrupar([mensagem("2026-11-17T10:00:00.000Z", leituras)]);

    // Então
    expect(resultado.map((d) => d.codigo)).toEqual(["OK"]);
  });

  it.each([
    ["não é JSON", "{quebrado"],
    ["é um array", "[1,2]"],
    ["é texto puro", '"PM25"'],
    ["é null", "null"],
    ["não tem leituras", JSON.stringify({ timestamp: "2026-11-17T10:00:00.000Z" })],
    ["tem leituras que não é lista", JSON.stringify({ timestamp: "2026-11-17T10:00:00.000Z", leituras: { sensor: "PM25" } })],
  ])("deve pular a mensagem cujo payload %s", (_motivo, payloadBruto) => {
    // Quando / Então: as outras mensagens continuam valendo.
    const resultado = agrupar([
      { payloadBruto, recebidoEm: "2026-11-17T10:00:00.000Z" },
      mensagem("2026-11-17T10:00:00.000Z", [{ sensor: "PM25", valor: 1 }]),
    ]);

    expect(resultado.map((d) => d.codigo)).toEqual(["PM25"]);
  });

  it("deve devolver ultimo_valor nulo quando o valor não é um número", () => {
    // Dado
    const leituras = [{ sensor: "PM25", valor: "12" }, { sensor: "PM10" }, { sensor: "UV", valor: 3 }];

    // Quando
    const resultado = agrupar([mensagem("2026-11-17T10:00:00.000Z", leituras)]);

    // Então
    const porCodigo = Object.fromEntries(resultado.map((d) => [d.codigo, d.ultimo_valor]));
    expect(porCodigo).toEqual({ PM25: null, PM10: null, UV: 3 });
  });

  it("deve respeitar o limite de códigos", () => {
    // Dado
    const leituras = Array.from({ length: 5 }, (_, i) => ({ sensor: `S-${i}`, valor: i }));

    // Quando
    const resultado = agrupar([mensagem("2026-11-17T10:00:00.000Z", leituras)], [], 3);

    // Então
    expect(resultado).toHaveLength(3);
  });

  it("deve devolver lista vazia quando não há mensagens", () => {
    expect(agrupar([])).toEqual([]);
  });
});
