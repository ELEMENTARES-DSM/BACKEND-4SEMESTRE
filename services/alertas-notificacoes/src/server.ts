import app from "./app";

const PORT = process.env.PORT || 3002;

app.listen(PORT, () => {
  console.log(`alertas-notificacoes running on port ${PORT}`);
});