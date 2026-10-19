/**
 * Estado da conexão com o broker MQTT (TASK 11.04), atualizado pelos eventos
 * do consumidor e lido pelo GET /ingestao/health. Começa desconectado.
 */
export class MqttStatusService {
  private conectado = false;

  public marcarConectado(): void {
    this.conectado = true;
  }

  public marcarDesconectado(): void {
    this.conectado = false;
  }

  public estaConectado(): boolean {
    return this.conectado;
  }
}

export const mqttStatusService = new MqttStatusService();
export default mqttStatusService;
