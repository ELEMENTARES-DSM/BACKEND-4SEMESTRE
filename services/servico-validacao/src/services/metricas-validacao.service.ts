export interface MetricasValidacao {
  leiturasIgnoradasSensorInativo: number;
  medidasInvalidasGravadas: number;
}

/**
 * Contadores exibidos em GET /validacao/metricas. Ficam em memória,
 * começam em 0 e zeram ao reiniciar o serviço.
 */
export class MetricasValidacaoService {
  private ignoradasSensorInativo = 0;
  private invalidasGravadas = 0;

  public incrementarIgnoradasSensorInativo(quantidade = 1): void {
    this.ignoradasSensorInativo += quantidade;
  }

  public incrementarMedidasInvalidasGravadas(quantidade = 1): void {
    this.invalidasGravadas += quantidade;
  }

  public obterMetricas(): MetricasValidacao {
    return {
      leiturasIgnoradasSensorInativo: this.ignoradasSensorInativo,
      medidasInvalidasGravadas: this.invalidasGravadas,
    };
  }

  public reset(): void {
    this.ignoradasSensorInativo = 0;
    this.invalidasGravadas = 0;
  }
}

export const metricasValidacaoService = new MetricasValidacaoService();
export default metricasValidacaoService;
