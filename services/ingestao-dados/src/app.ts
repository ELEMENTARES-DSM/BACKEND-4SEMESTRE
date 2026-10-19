import express from "express";
import cors from "cors";
import openapi from "./docs/openapi.json";
import metricasRoutes from "./routes/metricas.routes";
import { rabbitMqConectado } from "./services/staging-publisher.service";

const app = express();

// Necessário no desenvolvimento: Swagger UI e API usam portas diferentes.
if (process.env.SWAGGER_UI_ORIGIN) {
  app.use(cors({ origin: process.env.SWAGGER_UI_ORIGIN }));
}

app.use(express.json());

app.get("/ingestao/openapi.json", (_req, res) => {
  const publicUrl = process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT || 3000}`;
  res.json({
    ...openapi,
    servers: [{ url: publicUrl }],
  });
});

// Health verifica o processo HTTP e a disponibilidade do RabbitMQ.
app.get("/ingestao/health", (_req, res) => {
  const conectado = rabbitMqConectado();
  res.status(conectado ? 200 : 503).json({
    status: "ok",
    rabbitmq: conectado ? "conectado" : "desconectado",
  });
});

app.use("/ingestao/metricas", metricasRoutes);

export default app;
