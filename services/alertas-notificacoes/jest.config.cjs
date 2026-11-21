module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.spec.ts", "**/*.test.ts"],
  testPathIgnorePatterns: [
    "/node_modules/",
    "\\.integration\\.(test|spec)\\.ts$",
    "<rootDir>/src/tests/integration/",
  ],
  clearMocks: true,
  collectCoverageFrom: [
    "src/services/**/*.ts",
    "src/validations/**/*.ts",
    "src/utils/**/*.ts",
    "src/middlewares/**/*.ts",
    "!src/server.ts",
    "!src/app.ts",
    "!src/config/**",
    "!src/db/migrations/**",
    "!src/database/migrations/**",
    "!src/docs/**",
  ],
  coverageReporters: ["text", "json-summary"],
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
