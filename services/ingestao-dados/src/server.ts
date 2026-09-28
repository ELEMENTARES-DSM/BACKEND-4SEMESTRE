import app from "./app";

const PORT = process.env.PORT || 3005;

app.listen(PORT, () => {
  console.log(`ingestao-dados running on port ${PORT}`);
});