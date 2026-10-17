import { tokenEstaRevogado } from "../../services/token-blacklist.service";
import { redisClient } from "../../config/redis";

// Mock com factory (e não automock): o automock carregaria o módulo real,
// e o config/redis real tentaria abrir conexão com o Redis durante o teste.
jest.mock("../../config/redis", () => ({
  redisClient: { get: jest.fn() },
}));

// Cast para jest.Mock mantém o teste independente da lib de Redis usada
// (node-redis, ioredis...), já que os tipos de `get` variam entre elas.
const mockGet = redisClient.get as jest.Mock;

describe("token-blacklist.service", () => {
  describe("tokenEstaRevogado", () => {
    it("retorna true quando existe registro de revogação para o jti", async () => {
      mockGet.mockResolvedValue("1");

      await expect(tokenEstaRevogado("abc-123")).resolves.toBe(true);
    });

    it("retorna false quando não existe registro (redis devolve null)", async () => {
      mockGet.mockResolvedValue(null);

      await expect(tokenEstaRevogado("abc-123")).resolves.toBe(false);
    });

    it("consulta o redis com a chave 'token-revogado:<jti>'", async () => {
      mockGet.mockResolvedValue(null);

      await tokenEstaRevogado("abc-123");

      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(mockGet).toHaveBeenCalledWith("token-revogado:abc-123");
    });

    it("usa o jti informado na chave (tokens diferentes, chaves diferentes)", async () => {
      mockGet.mockResolvedValue(null);

      await tokenEstaRevogado("jti-1");
      await tokenEstaRevogado("jti-2");

      expect(mockGet).toHaveBeenNthCalledWith(1, "token-revogado:jti-1");
      expect(mockGet).toHaveBeenNthCalledWith(2, "token-revogado:jti-2");
    });

    it("considera revogado qualquer valor não nulo, inclusive string vazia", async () => {
      // O service só compara com null: "" também conta como revogado.
      mockGet.mockResolvedValue("");

      await expect(tokenEstaRevogado("abc-123")).resolves.toBe(true);
    });

    it("propaga o erro quando o redis falha (não assume 'não revogado')", async () => {
      mockGet.mockRejectedValue(new Error("redis indisponível"));

      await expect(tokenEstaRevogado("abc-123")).rejects.toThrow(
        "redis indisponível"
      );
    });
  });
});