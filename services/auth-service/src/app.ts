import express from "express";
import cors from "cors";
import openapi from "./docs/openapi.json";
import authRoutes from "./routes/auth.routes";
import { errorHandler } from "./middlewares/error-handler";

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

app.use("/auth", authRoutes);

app.use(errorHandler);

export default app;