import app from "./app";
import { pool } from "./config/db";
import { ConsumidorRabbitMqAlarmes } from "./events/consumers/rabbitmq-alarme.consumer";
import logger from "./utils/logger";

const PORT = process.env.PORT || 3002;

// US-23: avisos aos gestores a partir do evento alarme.disparado.
const consumidor = new ConsumidorRabbitMqAlarmes({
  url: process.env.RABBITMQ_URL ?? "amqp://localhost:5672",
});

const servidor = app.listen(PORT, () => {
  logger.info(`alertas-notificacoes running on port ${PORT}`);
});

void consumidor.iniciar();

const encerrar = async (): Promise<void> => {
  await consumidor.encerrar();
  await pool.end().catch(() => undefined);
  servidor.close(() => {
    process.exit(0);
  });
};

process.on("SIGTERM", () => void encerrar());
process.on("SIGINT", () => void encerrar());
