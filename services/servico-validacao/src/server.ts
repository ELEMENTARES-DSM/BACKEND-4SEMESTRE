import app from "./app";
import { pool } from "./config/db";
import {
  ConsumidorRabbitMqTelemetria,
  configurarConsumidorTelemetria,
  encerrarConsumidorTelemetria,
} from "./events/consumers/rabbitmq-telemetria.consumer";
import { RepublicadorAlarmes } from "./services/republicar-alarmes.service";
import logger from "./utils/logger";

const PORT = process.env.PORT || 3007;

// US-22: alarmes sem confirmação do RabbitMQ são republicados ao reconectar.
const republicador = new RepublicadorAlarmes({
  publicar: (alarmes) => consumidor.publicarAlarmes(alarmes),
});
const consumidor = new ConsumidorRabbitMqTelemetria({
  url: process.env.RABBITMQ_URL ?? "amqp://localhost:5672",
  agendarRepublicacaoAlarmes: () => republicador.agendar(),
});
configurarConsumidorTelemetria(consumidor);

const servidor = app.listen(PORT, () => {
  logger.info(`servico-validacao running on port ${PORT}`);
});

void consumidor.iniciar();

const encerrar = async (): Promise<void> => {
  republicador.encerrar();
  await encerrarConsumidorTelemetria();
  await pool.end().catch(() => undefined);
  servidor.close(() => {
    process.exit(0);
  });
};

process.on("SIGTERM", () => void encerrar());
process.on("SIGINT", () => void encerrar());