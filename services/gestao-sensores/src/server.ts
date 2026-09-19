import app from "./app";

const PORT = process.env.PORT || 3004;

app.listen(PORT, () => {
  console.log(`gestao-estacoes running on port ${PORT}`);
});