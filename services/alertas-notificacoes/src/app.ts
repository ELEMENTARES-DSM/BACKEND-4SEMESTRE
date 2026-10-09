import express from "express";
import cors from "cors";
import routes from "./routes";
import { errorHandler } from "./middlewares/error-handler";
import openapi from "./docs/openapi.json";

const app = express();

// Libera CORS para qualquer IP/Origem
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json());

app.get("/alertas/openapi.json", (_req, res) => {
  const publicUrl = process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT || 3000}`;
  res.json({
    ...openapi,
    servers: [{ url: publicUrl }],
  });
});

// Verificação básica do processo HTTP.
app.get("/alertas/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use(routes);

app.use(errorHandler);

export default app;
