import express from "express";
import cors from "cors";
import openapi from "./docs/openapi.json";
import medicoesRoutes from "./routes/medicoes.routes";

const app = express();

// Necessário no desenvolvimento: Swagger UI e API usam portas diferentes.
// Content-Disposition exposto para a tela ler o nome do CSV (US-31).
if (process.env.SWAGGER_UI_ORIGIN) {
  app.use(cors({ origin: process.env.SWAGGER_UI_ORIGIN, exposedHeaders: ["Content-Disposition"] }));
}
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

// Medições do município em JSON ou CSV, com login (US-31).
app.use("/relatorios/medicoes", medicoesRoutes);

export default app;
