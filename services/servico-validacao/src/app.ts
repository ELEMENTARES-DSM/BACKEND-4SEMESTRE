import express from "express";
import cors from "cors";
import openapi from "./docs/openapi.json";
import { obterSaude } from "./controllers/health.controller";
import metricasRoutes from "./routes/metricas.routes";
import dlqRoutes from "./routes/dlq.routes";

const app = express();

// Necessário no desenvolvimento: Swagger UI e API usam portas diferentes.
if (process.env.SWAGGER_UI_ORIGIN) {
  app.use(cors({ origin: process.env.SWAGGER_UI_ORIGIN }));
}
app.use(express.json());

app.get("/validacao/openapi.json", (_req, res) => {
  const publicUrl =
    process.env.PUBLIC_API_URL ||
    `http://localhost:${process.env.PORT || 3000}`;
  res.json({
    ...openapi,
    servers: [{ url: publicUrl }],
  });
});

// Informa o estado das conexões com PostgreSQL, RabbitMQ e a fila validacao.telemetria.
app.get("/validacao/health", obterSaude);

// Contadores da validação, restritos ao perfil ADMINISTRADOR.
app.use("/validacao/metricas", metricasRoutes);

// Reenvio manual da validacao.dlq para a fila, restrito ao perfil ADMINISTRADOR (US-20).
app.use("/validacao/dlq", dlqRoutes);

export default app;
