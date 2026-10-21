import { describe, it, expect, beforeEach } from "@jest/globals";
import { MqttStatusService } from "../../services/mqtt-status.service";

describe("MqttStatusService", () => {
  let service: MqttStatusService;

  beforeEach(() => {
    service = new MqttStatusService();
  });

  it("deve começar desconectado", () => {
    expect(service.estaConectado()).toBe(false);
  });

  it("deve ficar conectado ao marcar a conexão", () => {
    service.marcarConectado();

    expect(service.estaConectado()).toBe(true);
  });

  it("deve voltar a desconectado quando a conexão cai", () => {
    service.marcarConectado();
    service.marcarDesconectado();

    expect(service.estaConectado()).toBe(false);
  });
});
