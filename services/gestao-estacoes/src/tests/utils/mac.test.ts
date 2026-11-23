import { normalizarMac } from "../../utils/mac";

describe("normalizarMac", () => {
  it.each([
    ["aabbccddeeff", "aabbccddeeff"],
    ["AABBCCDDEEFF", "aabbccddeeff"],
    ["AA:BB:CC:DD:EE:FF", "aabbccddeeff"],
    ["aa-bb-cc-dd-ee-ff", "aabbccddeeff"],
    ["  aabbccddeeff  ", "aabbccddeeff"],
  ])("deve normalizar %s para %s", (entrada, esperado) => {
    expect(normalizarMac(entrada)).toBe(esperado);
  });

  it.each([
    "",
    "aabbccddeef",
    "aabbccddeefff",
    "gabbccddeeff",
    "AA:BB:CC:DD:EE",
    "AA:BB-CC:DD:EE:FF",
    "AABB.CCDD.EEFF",
  ])("deve recusar %j", (entrada) => {
    expect(normalizarMac(entrada)).toBeNull();
  });
});
