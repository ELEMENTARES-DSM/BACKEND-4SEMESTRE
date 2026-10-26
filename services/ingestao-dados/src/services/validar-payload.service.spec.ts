import { ValidarPayloadService } from "./validar-payload.service";

describe("ValidarPayloadService - Task 12.01", () => {
  let service: ValidarPayloadService;

  beforeEach(() => {
    service = new ValidarPayloadService();
  });

  const baseInput = {
    estacaoId: "e30a57e3-0d33-4f9e-86b2-6cb1690a7891",
    topico: "pulso/estacoes/e30a57e3-0d33-4f9e-86b2-6cb1690a7891/telemetria",
    recebidoEm: "2026-10-08T21:42:01.000Z",
  };

  test("Cenário 1: Payload válido", () => {
    const res = service.validar({
      ...baseInput,
      payloadBruto: JSON.stringify({
        timestamp: "2026-10-08T21:42:00Z",
        nivel_bateria: 80,
        leituras: [{ sensor: "TMP", valor: 25.4 }],
      }),
    });

    expect(res.sucesso).toBe(true);
    expect(res.motivoRejeicao).toBeUndefined();
  });

  test("Cenário 2: Payload que não é JSON", () => {
    const res = service.validar({
      ...baseInput,
      payloadBruto: "texto puro invalido",
    });

    expect(res.sucesso).toBe(false);
    expect(res.motivoRejeicao).toBe("Payload malformado");
  });

  test("Cenário 3: Sem timestamp", () => {
    const res = service.validar({
      ...baseInput,
      payloadBruto: JSON.stringify({
        nivel_bateria: 50,
        leituras: [{ sensor: "TMP", valor: 25.4 }],
      }),
    });

    expect(res.sucesso).toBe(false);
    expect(res.motivoRejeicao).toBe("Timestamp ausente ou inválido");
  });

  test("Cenário 4: Lista de leituras vazia", () => {
    const res = service.validar({
      ...baseInput,
      payloadBruto: JSON.stringify({
        timestamp: "2026-10-08T21:42:00Z",
        leituras: [],
      }),
    });

    expect(res.sucesso).toBe(false);
    expect(res.motivoRejeicao).toBe("Lista de leituras ausente ou vazia");
  });

  test("Cenário 5: Item de leitura incompleto", () => {
    const res = service.validar({
      ...baseInput,
      payloadBruto: JSON.stringify({
        timestamp: "2026-10-08T21:42:00Z",
        leituras: [{ sensor: "TMP" }], // sem valor
      }),
    });

    expect(res.sucesso).toBe(false);
    expect(res.motivoRejeicao).toBe(
      "Leitura inválida: sensor ou valor ausente",
    );
  });

  test("Cenário 6: Bateria fora da faixa", () => {
    const res = service.validar({
      ...baseInput,
      payloadBruto: JSON.stringify({
        timestamp: "2026-10-08T21:42:00Z",
        nivel_bateria: 140,
        leituras: [{ sensor: "TMP", valor: 25.4 }],
      }),
    });

    expect(res.sucesso).toBe(false);
    expect(res.motivoRejeicao).toBe("Nível de bateria fora de 0 a 100");
  });

  test("Cenário 7: Bateria não enviada (Opcional aceito)", () => {
    const res = service.validar({
      ...baseInput,
      payloadBruto: JSON.stringify({
        timestamp: "2026-10-08T21:42:00Z",
        leituras: [{ sensor: "TMP", valor: 25.4 }],
      }),
    });

    expect(res.sucesso).toBe(true);
  });
});
