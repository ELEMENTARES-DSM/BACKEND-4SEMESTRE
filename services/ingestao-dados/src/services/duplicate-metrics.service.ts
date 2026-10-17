export class DuplicateMetricsService {
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

export const duplicateMetricsService = new DuplicateMetricsService();
export default duplicateMetricsService;
