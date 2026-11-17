import { describe, it, expect, beforeEach } from "@jest/globals";
import { MqttStatusService } from "../../services/mqtt-status.service";

// Unitário de MqttStatusService: estado em memória, sem recurso externo.
describe("MqttStatusService", () => {
  let service: MqttStatusService;

  beforeEach(() => {
    service = new MqttStatusService();
  });

  describe("estaConectado", () => {
    it("deve devolver false quando a instância é nova", () => {
      // Dado (Arrange)
      // Quando (Act)
      const conectado = service.estaConectado();

      // Então (Assert)
      expect(conectado).toBe(false);
    });
  });

  describe("marcarConectado", () => {
    it("deve deixar conectado quando o broker aceita a conexão", () => {
      // Dado (Arrange)
      // Quando (Act)
      service.marcarConectado();

      // Então (Assert)
      expect(service.estaConectado()).toBe(true);
    });
  });

  describe("marcarDesconectado", () => {
    it("deve voltar a desconectado quando a conexão cai", () => {
      // Dado (Arrange)
      service.marcarConectado();

      // Quando (Act)
      service.marcarDesconectado();

      // Então (Assert)
      expect(service.estaConectado()).toBe(false);
    });
  });
});
