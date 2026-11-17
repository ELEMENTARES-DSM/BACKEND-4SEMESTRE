module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/src/tests"],
  testMatch: ["**/*.test.ts"],
  // Os testes de src/tests/integration precisam de banco: rodam em npm run test:integration.
  testPathIgnorePatterns: ["/node_modules/", "<rootDir>/src/tests/integration/"],
  clearMocks: true,
  collectCoverageFrom: [
    "src/services/public-estacoes.service.ts",
    "src/routes/public-estacao.routes.ts",
    "src/services/tipo-sensor.service.ts",
    "src/validations/tipo-sensor.validation.ts",
  ],
  coverageThreshold: {
    global: {
      lines: 70,
      functions: 70,
      branches: 70,
      statements: 70,
    },
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: { types: ["node", "jest"] } }],
  },
};
