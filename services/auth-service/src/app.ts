import express from "express";
import { authMiddleware, checkRole } from "./middlewares/middleware";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
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