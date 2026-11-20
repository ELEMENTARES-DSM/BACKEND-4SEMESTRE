import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import openapi from "./docs/openapi.json";
import medicoesRoutes from "./routes/medicoes.routes";
import logger from "./utils/logger";

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

// Garante erro em JSON (e não HTML padrão do Express) em falhas inesperadas no formato JSON.
app.use((erro: Error, _req: Request, res: Response, _next: NextFunction) => {
  void _next;
  logger.error("Erro inesperado no serviço de relatórios", { erro: erro.message });
  if (res.headersSent) return;
  res.status(500).json({ erro: "Erro interno do servidor." });
});

export default app;
