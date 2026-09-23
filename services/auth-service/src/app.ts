import express from "express";
import { authMiddleware, checkRole } from "./middlewares/middleware";
import cors from "cors";
import openapi from "./docs/openapi.json";
import authRoutes from "./routes/auth.routes";
import { errorHandler } from "./middlewares/error-handler";

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

app.use("/auth", authRoutes);

app.use(errorHandler);

export default app;
