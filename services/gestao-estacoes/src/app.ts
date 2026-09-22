import express from "express";
import routes from "./routes";
import { errorHandler } from "./middlewares/error-handler";
import cors from "cors";
import openapi from "./docs/openapi.json";

const app = express();

// Necessário no desenvolvimento: Swagger UI e API usam portas diferentes.
if (process.env.SWAGGER_UI_ORIGIN) {
  app.use(cors({ origin: process.env.SWAGGER_UI_ORIGIN }));
}

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use(routes);

app.use(errorHandler);

export default app;
app.get("/estacoes/openapi.json", (_req, res) => {
  const publicUrl = process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT || 3000}`;
  res.json({
    ...openapi,
    servers: [{ url: publicUrl }],
  });
});

// Verificação básica do processo HTTP.
app.get("/estacoes/health", (_req, res) => {
  res.json({ status: "ok" });
});

export default app;
