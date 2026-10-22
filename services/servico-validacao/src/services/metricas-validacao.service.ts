export interface MetricasValidacao {
  leiturasIgnoradasSensorInativo: number;
}

/**
 * Contadores exibidos em GET /validacao/metricas. Ficam em memória,
 * começam em 0 e zeram ao reiniciar o serviço.
 */
export class MetricasValidacaoService {
  private ignoradasSensorInativo = 0;

  public incrementarIgnoradasSensorInativo(quantidade = 1): void {
    this.ignoradasSensorInativo += quantidade;
  }

  public obterMetricas(): MetricasValidacao {
    return {
      leiturasIgnoradasSensorInativo: this.ignoradasSensorInativo,
    };
  }

  public reset(): void {
    this.ignoradasSensorInativo = 0;
  }
}

export const metricasValidacaoService = new MetricasValidacaoService();
export default metricasValidacaoService;
