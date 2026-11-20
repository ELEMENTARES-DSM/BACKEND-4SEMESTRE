import "dotenv/config";
import app from "./app";
import { conectarValkey } from "./config/valkey";

const PORT = process.env.PORT || 3003;

conectarValkey().then(() => {
  app.listen(PORT, () => {
    console.log(`analise-dados running on port ${PORT}`);
  });
});