module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.spec.ts", "**/*.test.ts"],
  clearMocks: true,
  collectCoverageFrom: [
    "src/services/rejection-metrics.service.ts",
    "src/services/registro-rejeicao.service.ts",
    "src/services/duplicate-metrics.service.ts",
    "src/services/registro-duplicada.service.ts",
    "src/services/received-metrics.service.ts",
    "src/services/gravacao-metrics.service.ts",
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
