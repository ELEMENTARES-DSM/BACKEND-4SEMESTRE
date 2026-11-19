module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.spec.ts", "**/*.test.ts"],
  clearMocks: true,
  resetMocks: true,
  collectCoverageFrom: [
    "src/services/registro-rejeicao.service.ts",
    "src/services/registro-duplicada.service.ts",
    "src/services/processar-mensagem.service.ts",
    "src/repositories/staging-valkey.repository.ts",
    "src/repositories/estacao.repository.ts",
    "src/controllers/metricas.controller.ts",
    "src/utils/conexao-pg.ts",
    "src/services/mqtt-status.service.ts",
    "src/controllers/health.controller.ts",
    "src/utils/logger.ts",
    "src/validations/motivos-rejeicao.ts",
  ],
  coverageThreshold: {
    global: {
      lines: 90,
      functions: 90,
    },
  },
};
