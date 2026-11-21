import {
  revogarToken,
  tokenEstaRevogado,
} from "../../services/token-blacklist.service";
import { redisClient } from "../../config/redis";

jest.mock("../../config/redis", () => ({
  redisClient: {
    set: jest.fn(),
    get: jest.fn(),
  },
}));

const mockSet = redisClient.set as jest.Mock;
const mockGet = redisClient.get as jest.Mock;

describe("token-blacklist.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("revogarToken", () => {
    it("não deve gravar no Redis quando o token já expirou", async () => {
      const expPassado = Math.floor(Date.now() / 1000) - 10;

      await revogarToken("jti-expirado", expPassado);

      expect(mockSet).not.toHaveBeenCalled();
    });

    it("deve gravar a chave com TTL restante no Redis quando o token ainda é válido", async () => {
      jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
      mockSet.mockResolvedValue("OK");

      await revogarToken("jti-valido", 1_700_000_300);

      expect(mockSet).toHaveBeenCalledWith("token-revogado:jti-valido", "1", {
        EX: 300,
      });
      jest.restoreAllMocks();
    });
  });

  describe("tokenEstaRevogado", () => {
    it("deve retornar true quando a chave existe no Redis", async () => {
      mockGet.mockResolvedValue("1");

      await expect(tokenEstaRevogado("jti-1")).resolves.toBe(true);
      expect(mockGet).toHaveBeenCalledWith("token-revogado:jti-1");
    });

    it("deve retornar false quando a chave não existe no Redis", async () => {
      mockGet.mockResolvedValue(null);

      await expect(tokenEstaRevogado("jti-2")).resolves.toBe(false);
    });
  });
});
