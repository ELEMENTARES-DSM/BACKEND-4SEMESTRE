/**
 * Contadores de gravação no staging (TASK 14.03): mensagens aceitas gravadas
 * e rejeitadas gravadas. Duplicata não grava, então não conta. Ficam em
 * memória e zeram ao reiniciar, como os demais contadores do serviço.
 */
export class GravacaoMetricsService {
  private gravadas = 0;
  private rejeitadasGravadas = 0;

  public incrementarGravada(): void {
    this.gravadas += 1;
  }

  public incrementarRejeitadaGravada(): void {
    this.rejeitadasGravadas += 1;
  }

  public obterMensagensGravadas(): number {
    return this.gravadas;
  }

  public obterRejeitadasGravadas(): number {
    return this.rejeitadasGravadas;
  }

  public reset(): void {
    this.gravadas = 0;
    this.rejeitadasGravadas = 0;
  }
}

export const gravacaoMetricsService = new GravacaoMetricsService();
export default gravacaoMetricsService;
