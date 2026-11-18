import app from "./app";
import { carregarConfigMqtt } from "./config/mqtt.config";
import { ConsumidorMqttTelemetria } from "./events/consumers/mqtt-telemetria.consumer";
import { RabbitMqTelemetriaPublisher } from "./events/publishers/rabbitmq-telemetria.publisher";
import {
  encerrarVerificacao,
  iniciarVerificacao,
  receberMensagem,
} from "./services/processar-mensagem.service";
import { configurarPublisherStaging, encerrarPublisherStaging } from "./services/staging-publisher.service";
import { encerrarValkey, valkey } from "./config/valkey";

const PORT = process.env.PORT || 3005;
const intervaloRecuperacaoConfigurado = Number(process.env.RABBITMQ_RECOVERY_INTERVAL_MS);
const intervaloRecuperacaoMs = Number.isSafeInteger(intervaloRecuperacaoConfigurado)
  && intervaloRecuperacaoConfigurado > 0
  ? intervaloRecuperacaoConfigurado
  : 10000;

// US-40: cada mensagem é gravada bruta no Valkey e só então confirmada ao
// broker; as verificações leem a mensagem do Valkey depois.
valkey();
const clienteMqtt = new ConsumidorMqttTelemetria({
  config: carregarConfigMqtt(),
  proximoPasso: receberMensagem,
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
iniciarVerificacao();
void rabbitMqPublisher.iniciar();

const encerrar = async () => {
  await clienteMqtt.encerrar();
  encerrarVerificacao();
  await encerrarPublisherStaging();
  await encerrarValkey();
  process.exit(0);
};

process.on("SIGTERM", encerrar);
process.on("SIGINT", encerrar);
