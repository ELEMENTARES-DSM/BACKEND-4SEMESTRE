module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.test.ts"],
  resetMocks: true,
  collectCoverageFrom: [
    "src/controllers/**/*.ts",
    "src/middlewares/**/*.ts",
    "src/services/**/*.ts",
    "src/utils/**/*.ts",
    "src/validations/**/*.ts",
    "!src/utils/logger.ts",
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
