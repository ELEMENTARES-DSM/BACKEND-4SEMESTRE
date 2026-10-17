export class RejectionMetricsService {
  private metricas: Map<string, number> = new Map();

  public incrementarRejeicao(motivo: string): void {
    const contagemAtual = this.metricas.get(motivo) ?? 0;
    this.metricas.set(motivo, contagemAtual + 1);
  }

  public obterMetricas(): Record<string, number> {
    return Object.fromEntries(this.metricas.entries());
  }

  public reset(): void {
    this.metricas.clear();
  }
}

export const rejectionMetricsService = new RejectionMetricsService();
export default rejectionMetricsService;
