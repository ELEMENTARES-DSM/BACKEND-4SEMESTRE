import { ValidarPayloadService } from "../../services/validar-payload.service";

// Unitário de ValidarPayloadService.validar: função pura, sem recurso externo.
const base = {
  macAddress: "e30a57e3-0d33-4f9e-86b2-6cb1690a7891",
  topico: "pulso/estacoes/e30a57e3-0d33-4f9e-86b2-6cb1690a7891/telemetria",
  recebidoEm: "2026-10-08T21:42:01.000Z",
};

const comPayload = (payload: unknown) => ({ ...base, payloadBruto: JSON.stringify(payload) });

describe("ValidarPayloadService", () => {
  describe("validar", () => {
    let service: ValidarPayloadService;

    beforeEach(() => {
      service = new ValidarPayloadService();
    });

    it("deve aceitar quando timestamp, bateria e leituras são válidos", () => {
      // Dado (Arrange)
      const mensagem = comPayload({ timestamp: "2026-10-08T21:42:00Z", nivel_bateria: 80, leituras: [{ sensor: "TMP", valor: 25.4 }] });

      // Quando (Act)
      const resultado = service.validar(mensagem);

      // Então (Assert)
      expect(resultado.sucesso).toBe(true);
      expect(resultado.motivoRejeicao).toBeUndefined();
    });

    it("deve recusar com \"Payload malformado\" quando o conteúdo não é JSON", () => {
      // Dado (Arrange)
      const mensagem = { ...base, payloadBruto: "texto puro invalido" };

      // Quando (Act)
      const resultado = service.validar(mensagem);

      // Então (Assert)
      expect(resultado).toEqual({ sucesso: false, motivoRejeicao: "Payload malformado" });
    });

    it("deve recusar com \"Timestamp ausente ou inválido\" quando não há timestamp", () => {
      // Dado (Arrange)
      const mensagem = comPayload({ nivel_bateria: 50, leituras: [{ sensor: "TMP", valor: 25.4 }] });

      // Quando (Act)
      const resultado = service.validar(mensagem);

      // Então (Assert)
      expect(resultado.motivoRejeicao).toBe("Timestamp ausente ou inválido");
    });

    it("deve recusar com \"Lista de leituras ausente ou vazia\" quando a lista está vazia", () => {
      // Dado (Arrange)
      const mensagem = comPayload({ timestamp: "2026-10-08T21:42:00Z", leituras: [] });

      // Quando (Act)
      const resultado = service.validar(mensagem);

      // Então (Assert)
      expect(resultado.motivoRejeicao).toBe("Lista de leituras ausente ou vazia");
    });

    it("deve recusar com \"Leitura inválida: sensor ou valor ausente\" quando um item não tem valor", () => {
      // Dado (Arrange)
      const mensagem = comPayload({ timestamp: "2026-10-08T21:42:00Z", leituras: [{ sensor: "TMP" }] });

      // Quando (Act)
      const resultado = service.validar(mensagem);

      // Então (Assert)
      expect(resultado.motivoRejeicao).toBe("Leitura inválida: sensor ou valor ausente");
    });

    it("deve recusar com \"Nível de bateria fora de 0 a 100\" quando a bateria é 140", () => {
      // Dado (Arrange)
      const mensagem = comPayload({ timestamp: "2026-10-08T21:42:00Z", nivel_bateria: 140, leituras: [{ sensor: "TMP", valor: 25.4 }] });

      // Quando (Act)
      const resultado = service.validar(mensagem);

      // Então (Assert)
      expect(resultado.motivoRejeicao).toBe("Nível de bateria fora de 0 a 100");
    });

    it("deve aceitar quando a bateria não é enviada, porque ela é opcional", () => {
      // Dado (Arrange)
      const mensagem = comPayload({ timestamp: "2026-10-08T21:42:00Z", leituras: [{ sensor: "TMP", valor: 25.4 }] });

      // Quando (Act)
      const resultado = service.validar(mensagem);

      // Então (Assert)
      expect(resultado.sucesso).toBe(true);
    });
  });
});
