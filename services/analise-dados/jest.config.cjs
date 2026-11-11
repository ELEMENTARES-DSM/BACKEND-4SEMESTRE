module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/src/tests"],
  testMatch: ["**/*.spec.ts"],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", {
      tsconfig: {
        types: ["node", "jest"],
      },
    }],
  },
};
