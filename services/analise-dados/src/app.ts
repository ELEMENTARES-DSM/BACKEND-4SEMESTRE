import express from "express";
import cors from "cors";
import openapi from "./docs/openapi.json";
import analiseRoutes from "./routes/analise.routes";

const app = express();

// Necessário no desenvolvimento: Swagger UI e API usam portas diferentes.
if (process.env.SWAGGER_UI_ORIGIN) {
  app.use(cors({ origin: process.env.SWAGGER_UI_ORIGIN }));
}
app.use(express.json());

app.get("/analise/openapi.json", (_req, res) => {
  const publicUrl = process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT || 3000}`;
  res.json({
    ...openapi,
    servers: [{ url: publicUrl }],
  });
});

// Verificação básica do processo HTTP.
app.get("/analise/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Rotas de análise e rotas públicas compatibilizadas com limites por perfil
app.use("/analise", analiseRoutes);
app.use("/public/analise", analiseRoutes);

export default app;
