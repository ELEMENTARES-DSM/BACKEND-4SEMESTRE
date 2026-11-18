import {
  EventoTelemetriaBruta,
  RabbitMqTelemetriaPublisher,
} from "../events/publishers/rabbitmq-telemetria.publisher";

let publisher: RabbitMqTelemetriaPublisher | undefined;

export function configurarPublisherStaging(novoPublisher: RabbitMqTelemetriaPublisher): void {
  publisher = novoPublisher;
}

export function solicitarProcessamentoPendentes(): void {
  void publisher?.processarPendentes();
}

export async function publicarLeituraAtrasada(evento: EventoTelemetriaBruta): Promise<void> {
  if (!publisher) throw new Error("Publicador RabbitMQ não configurado");
  await publisher.publicarDiretamente(evento);
}

export function rabbitMqConectado(): boolean {
  return publisher?.conectado() ?? false;
}

export async function encerrarPublisherStaging(): Promise<void> {
  await publisher?.encerrar();
}
