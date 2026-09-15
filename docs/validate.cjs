const fs = require("node:fs");
const path = require("node:path");
const SwaggerParser = require("@apidevtools/swagger-parser");

async function main() {
  const servicesRoot = path.resolve(__dirname, "../services");
  const services = fs.readdirSync(servicesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory()
      && fs.existsSync(path.join(servicesRoot, entry.name, "package.json")))
    .map((entry) => entry.name)
    .sort();

  if (services.length === 0) {
    throw new Error("Nenhum microsserviço encontrado em services/.");
  }

  for (const service of services) {
    const file = path.join(servicesRoot, service, "src/docs/openapi.json");
    if (!fs.existsSync(file)) {
      throw new Error(`Contrato OpenAPI ausente: ${service}/src/docs/openapi.json`);
    }
    const api = await SwaggerParser.validate(file);
    const methods = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);
    const count = Object.values(api.paths).reduce(
      (total, item) => total + Object.keys(item).filter((key) => methods.has(key)).length,
      0,
    );
    console.log(`${service}: contrato válido, ${count} operação(ões).`);
  }
  console.log("Validação estrutural concluída. Isso não testa a execução das APIs nem sua cobertura.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
