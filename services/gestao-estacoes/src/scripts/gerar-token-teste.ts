// Script só para gerar um token de teste válido.
// Rode dentro do container: docker compose exec gestao-estacoes npx tsx src/scripts/gerar-token-teste.ts

import "dotenv/config";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET as string;

if (!JWT_SECRET) {
  console.error("JWT_SECRET não foi encontrado no ambiente! Confira o .env na raiz do projeto e o docker-compose.yml.");
  process.exit(1);
}

const token = jwt.sign(
  {
    id: "1",
    papel: "GESTOR_PUBLICO",
    municipio: "São José dos Campos",
  },
  JWT_SECRET,
  { expiresIn: "1h" }
);

console.log("JWT_SECRET usado:", JWT_SECRET);
console.log("\nToken gerado (papel: GESTOR_PUBLICO):\n");
console.log(token);