import express from "express";
import cors from "cors";
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

app.get("/relatorios/openapi.json", (_req, res) => {
  const publicUrl = process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT || 3000}`;
  res.json({
    ...openapi,
    servers: [{ url: publicUrl }],
  });
});

// Verificação básica do processo HTTP.
app.get("/relatorios/health", (_req, res) => {
  res.json({ status: "ok" });
});

export default app;
