import app from "./app";
import { carregarConfigMqtt } from "./config/mqtt.config";
import { ConsumidorMqttTelemetria } from "./events/consumers/mqtt-telemetria.consumer";
import { RabbitMqTelemetriaPublisher } from "./events/publishers/rabbitmq-telemetria.publisher";
import { encaminharParaIngestao } from "./services/processar-mensagem.service";
import { configurarPublisherStaging, encerrarPublisherStaging } from "./services/staging-publisher.service";

const PORT = process.env.PORT || 3005;
const intervaloRecuperacaoConfigurado = Number(process.env.RABBITMQ_RECOVERY_INTERVAL_MS);
const intervaloRecuperacaoMs = Number.isSafeInteger(intervaloRecuperacaoConfigurado)
  && intervaloRecuperacaoConfigurado > 0
  ? intervaloRecuperacaoConfigurado
  : 10000;

// Cada mensagem segue o fluxo da ingestão; o broker só recebe a confirmação
// depois que a mensagem foi gravada no staging (ou rejeitada com motivo).
const clienteMqtt = new ConsumidorMqttTelemetria({
  config: carregarConfigMqtt(),
  proximoPasso: encaminharParaIngestao,
});

const rabbitMqPublisher = new RabbitMqTelemetriaPublisher({
  url: process.env.RABBITMQ_URL ?? "amqp://localhost:5672",
  intervaloRecuperacaoMs,
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
