module.exports = {
  testEnvironment: "node",
  // tests/integration: fluxo contra a API no Docker Compose (variáveis TEST_*).
  // src/tests/integration: migrations e rotas contra o banco de teste.
  roots: ["<rootDir>/tests/integration", "<rootDir>/src/tests/integration"],
  testMatch: ["**/*.test.ts"],
  maxWorkers: 1,
  testTimeout: 15000,
  transform: {
    "^.+\\.tsx?$": ["ts-jest", {
      tsconfig: { rootDir: ".", types: ["node", "jest"] },
    }],
  },
};
