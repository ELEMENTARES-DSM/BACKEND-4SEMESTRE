/**
 * Contador "leituras recebidas" (TASK 11.04): mensagens de tópico válido
 * entregues ao próximo passo. Fica em memória e zera ao reiniciar.
 */
export class ReceivedMetricsService {
  private total = 0;

  public incrementar(): void {
    this.total += 1;
  }

  public obterTotal(): number {
    return this.total;
  }

  public reset(): void {
    this.total = 0;
  }
}

export const receivedMetricsService = new ReceivedMetricsService();
export default receivedMetricsService;
