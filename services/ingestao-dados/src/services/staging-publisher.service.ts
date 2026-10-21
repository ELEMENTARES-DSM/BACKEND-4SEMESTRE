import { RabbitMqTelemetriaPublisher } from "../events/publishers/rabbitmq-telemetria.publisher";

let publisher: RabbitMqTelemetriaPublisher | undefined;

export function configurarPublisherStaging(novoPublisher: RabbitMqTelemetriaPublisher): void {
  publisher = novoPublisher;
}

export function solicitarProcessamentoPendentes(): void {
  void publisher?.processarPendentes();
}

export function rabbitMqConectado(): boolean {
  return publisher?.conectado() ?? false;
}

export async function encerrarPublisherStaging(): Promise<void> {
  await publisher?.encerrar();
}
