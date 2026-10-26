module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/tests/integration"],
  testMatch: ["**/*.test.ts"],
  maxWorkers: 1,
  testTimeout: 15000,
  transform: {
    "^.+\\.tsx?$": ["ts-jest", {
      tsconfig: { rootDir: ".", types: ["node", "jest"] },
    }],
  },
};
