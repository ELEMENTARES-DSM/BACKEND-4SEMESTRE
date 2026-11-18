module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.spec.ts", "**/*.test.ts"],
  resetMocks: true,
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: { types: ["node", "jest"] } }],
  },
};
