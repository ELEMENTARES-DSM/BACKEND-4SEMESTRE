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

// Rotas exclusivas de gestão/administração que NUNCA podem aparecer no Swagger público
const ROTAS_GESTÃO_PROIBIDAS_NO_PUBLICO = [
  /\/usuarios\b(?!\/cadastro\b)/i, // qualquer rota de /usuarios exceto /usuarios/cadastro
  /\/papeis/i,
  /\/inativar/i,
  /\/internal/i,
  /\/regras-alerta/i,
  /\/notificacoes/i,
  /\/validacao/i,
  /\/ingestao/i,
];

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
        entry.name !== "simulador-estacoes" &&
        fs.existsSync(path.join(servicesRoot, entry.name, "package.json")),
    )
    .map((entry) => entry.name)
    .sort();

  if (services.length === 0) {
    throw new Error("Nenhum microsserviço encontrado em services/.");
  }

  // 1. Validação dos contratos OpenAPI por microsserviço
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

  // 2. Validação do contrato OpenAPI público (Task 42.06 / ELEM-276)
  const publicOpenApiPath = path.resolve(__dirname, "openapi-publico.json");
  if (fs.existsSync(publicOpenApiPath)) {
    const publicApi = await SwaggerParser.validate(publicOpenApiPath);
    const paths = publicApi.paths ?? {};

    // Critério de aceite: Nenhuma rota de gestão pode aparecer no Swagger público
    for (const routePath of Object.keys(paths)) {
      for (const pattern of ROTAS_GESTÃO_PROIBIDAS_NO_PUBLICO) {
        if (pattern.test(routePath)) {
          throw new Error(
            `Falha de segurança no Swagger público: rota administrativa/gestão detectada indevidamente: "${routePath}"`
          );
        }
      }
    }

    const publicOperations = Object.values(paths).reduce((total, pathItem) => {
      if (!pathItem || typeof pathItem !== "object") return total;
      return total + Object.keys(pathItem).filter((k) => HTTP_METHODS.has(k.toLowerCase())).length;
    }, 0);

    console.log(
      `openapi-publico: contrato válido e seguro contra rotas de gestão, ${publicOperations} operação(ões).`,
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
