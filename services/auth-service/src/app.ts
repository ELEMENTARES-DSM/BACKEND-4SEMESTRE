import express from "express";
import { authMiddleware, checkRole } from "./middlewares/middleware";
import cors from "cors";
import openapi from "./docs/openapi.json";

const app = express();

// Necessário no desenvolvimento: Swagger UI e API usam portas diferentes.
if (process.env.SWAGGER_UI_ORIGIN) {
  app.use(cors({ origin: process.env.SWAGGER_UI_ORIGIN }));
}

app.use(express.json());

app.get("/auth/openapi.json", (_req, res) => {
  const publicUrl = process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT || 3000}`;
  res.json({
    ...openapi,
    servers: [{ url: publicUrl }],
  });
});

// Verificação básica do processo HTTP.
app.get("/auth/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/teste-auth", authMiddleware, (req, res) => {
  res.json({
    mensagem: "Token válido! Você está autenticado.",
    usuario: req.usuario,
  });
});

app.get(
  "/teste-auth-admin",
  authMiddleware,
  checkRole(["admin"]),
  (req, res) => {
    res.json({ mensagem: "Você é admin, acesso liberado." });
  }
);

export default app;
