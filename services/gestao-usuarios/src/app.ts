import express from "express";
import cors from "cors";
import routes from "./routes";
import { errorHandler } from "./middlewares/error-handler";
import openapi from "./docs/openapi.json";

const app = express();

// Necessário no desenvolvimento: Swagger UI e API usam portas diferentes.
if (process.env.SWAGGER_UI_ORIGIN) {
  app.use(cors({ origin: process.env.SWAGGER_UI_ORIGIN }));
}

app.use(express.json());

app.get("/openapi.json", (_req, res) => {
  const publicUrl = process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT || 3000}`;
  res.json({
    ...openapi,
    servers: [{ url: publicUrl }],
  });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use(routes);

app.use(errorHandler);

export default app;