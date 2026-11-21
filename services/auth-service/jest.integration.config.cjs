module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: [
    "**/*.integration.test.ts",
    "**/*.integration.spec.ts",
    "**/tests/integration/**/*.test.ts",
    "**/tests/integration/**/*.spec.ts",
  ],
  clearMocks: true,
  maxWorkers: 1,
  testTimeout: 30000,
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: { types: ["node", "jest"] } }],
  },
};
