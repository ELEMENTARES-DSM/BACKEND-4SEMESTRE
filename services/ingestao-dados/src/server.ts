import app from "./app";
import { carregarConfigMqtt } from "./config/mqtt.config";
import { ConsumidorMqttTelemetria, ProximoPasso } from "./events/consumers/mqtt-telemetria.consumer";
import { RabbitMqTelemetriaPublisher } from "./events/publishers/rabbitmq-telemetria.publisher";
import { configurarPublisherStaging, encerrarPublisherStaging } from "./services/staging-publisher.service";

const PORT = process.env.PORT || 3005;

// Provisório até a US-12: o próximo passo ainda não existe, então a mensagem só é registrada.
const encaminharProximoPasso: ProximoPasso = async (mensagem) => {
  console.log(`[ingestao] mensagem de ${mensagem.estacaoId} recebida em ${mensagem.recebidoEm}`);
};

const clienteMqtt = new ConsumidorMqttTelemetria({
  config: carregarConfigMqtt(),
  proximoPasso: encaminharProximoPasso,
});

const rabbitMqPublisher = new RabbitMqTelemetriaPublisher({
  url: process.env.RABBITMQ_URL ?? "amqp://localhost:5672",
});
configurarPublisherStaging(rabbitMqPublisher);

app.listen(PORT, () => {
  console.log(`ingestao-dados running on port ${PORT}`);
});

clienteMqtt.iniciar();
void rabbitMqPublisher.iniciar();

const encerrar = async () => {
  await clienteMqtt.encerrar();
  await encerrarPublisherStaging();
  process.exit(0);
};

process.on("SIGTERM", encerrar);
process.on("SIGINT", encerrar);
