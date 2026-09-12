import express from "express";

const app = express();
app.use(express.json());

// aplicação minima
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

export default app;