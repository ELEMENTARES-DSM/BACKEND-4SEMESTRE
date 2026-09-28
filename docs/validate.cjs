const fs = require("node:fs");
const path = require("node:path");
const SwaggerParser = require("@apidevtools/swagger-parser");

const HTTP_METHODS = new Set([
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
]);

async function main() {
  const servicesRoot = path.resolve(__dirname, "../services");

  if (!fs.existsSync(servicesRoot)) {
    throw new Error(`Diretório de microsserviços não encontrado: ${servicesRoot}`);
  }

  const services = fs
    .readdirSync(servicesRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        fs.existsSync(path.join(servicesRoot, entry.name, "package.json")),
    )
    .map((entry) => entry.name)
    .sort();

  if (services.length === 0) {
    throw new Error("Nenhum microsserviço encontrado em services/.");
  }

  for (const service of services) {
    const file = path.join(
      servicesRoot,
      service,
      "src",
      "docs",
      "openapi.json",
    );

    if (!fs.existsSync(file)) {
      throw new Error(
        `Contrato OpenAPI ausente: ${service}/src/docs/openapi.json`,
      );
    }

    const api = await SwaggerParser.validate(file);
    const paths = api.paths ?? {};

    const operationCount = Object.values(paths).reduce((total, pathItem) => {
      if (!pathItem || typeof pathItem !== "object") {
        return total;
      }

      const methods = Object.keys(pathItem).filter((key) =>
        HTTP_METHODS.has(key.toLowerCase()),
      );

      return total + methods.length;
    }, 0);

    console.log(
      `${service}: contrato válido, ${operationCount} operação(ões).`,
    );
  }

  console.log(
    "Validação estrutural concluída. Isso não testa a execução das APIs nem sua cobertura.",
  );
}

main().catch((error) => {
  console.error(`Falha na validação OpenAPI: ${error.message}`);
  process.exitCode = 1;
});