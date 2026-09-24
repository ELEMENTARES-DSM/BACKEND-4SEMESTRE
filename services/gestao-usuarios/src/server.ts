import app from "./app";
import { connectRedis } from "./config/redis";

const PORT = process.env.PORT || 3001;

connectRedis()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`gestao-usuarios running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Falha ao conectar no Redis. Encerrando.", err);
    process.exit(1);
  });