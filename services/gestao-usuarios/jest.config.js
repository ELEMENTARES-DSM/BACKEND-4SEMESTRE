const { createDefaultPreset } = require("ts-jest");

const tsJestTransformCfg = createDefaultPreset().transform;

/** @type {import("jest").Config} **/
module.exports = {
  testEnvironment: "node",
  transform: {
    ...tsJestTransformCfg,
  },
  // Zera calls e implementações dos mocks antes de cada teste,
  // evitando que um teste "vaze" estado pro próximo.
  resetMocks: true,
};