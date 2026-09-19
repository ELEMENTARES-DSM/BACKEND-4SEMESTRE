// Script só para gerar um token de teste válido.
// Rode dentro do container: docker-compose exec auth-service npx tsx src/scripts/gerar-token-teste.ts
// (ou localmente, dentro de services/auth-service, se tiver o .env acessível: npx tsx src/scripts/gerar-token-teste.ts)

import "dotenv/config";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET as string;

if (!JWT_SECRET) {
  console.error("JWT_SECRET não foi encontrado no ambiente! Confira o .env na raiz do projeto.");
  process.exit(1);
}

const token = jwt.sign(
  {
    id: "1",
    papel: "admin",
    municipio: "São José dos Campos",
  },
  JWT_SECRET,
  { expiresIn: "1h" }
);

console.log("JWT_SECRET usado:", JWT_SECRET);
console.log("\nToken gerado:\n");
console.log(token);