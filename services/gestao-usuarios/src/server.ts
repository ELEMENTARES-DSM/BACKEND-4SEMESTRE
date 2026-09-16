import app from "./app";

const PORT = process.env.PORT || 3008;

app.listen(PORT, () => {
  console.log(`gestao-usuarios running on port ${PORT}`);
});