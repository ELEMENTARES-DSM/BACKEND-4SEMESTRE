import { pool } from "../../config/db";
import * as sensorRepository from "../../repositories/sensor.repository";

jest.mock("../../config/db", () => ({
  pool: { query: jest.fn() },
}));

const query = jest.mocked(pool.query) as unknown as jest.Mock;

const dados = {
  codigo: "TEMP-K",
  nome: "Termômetro",
  tipo: "Temperatura",
  unidadeMedida: "°C",
  unidadeLeitura: "K" as string | null,
  fator: 1,
  ganho: -273.15,
};

describe("sensor.repository (US-39)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    query.mockResolvedValue({ rows: [{ id: "s1" }] });
  });

  describe("create", () => {
    it("deve gravar unidade_leitura com placeholders, na ordem das colunas", async () => {
      // Quando
      await sensorRepository.create("estacao-1", dados);

      // Então
      const [sql, valores] = query.mock.calls[0];
      expect(sql).toContain("unidade_leitura");
      expect(sql).not.toContain("K");
      expect(valores).toEqual(["estacao-1", "Temperatura", "°C", "K", 1, -273.15, "TEMP-K", "Termômetro"]);
    });

    it("deve gravar NULL quando o sensor não tem unidade de leitura", async () => {
      // Quando
      await sensorRepository.create("estacao-1", { ...dados, unidadeLeitura: null });

      // Então
      expect(query.mock.calls[0][1][3]).toBeNull();
    });
  });

  describe("update", () => {
    it("deve atualizar unidade_leitura junto com a grandeza, na ordem dos placeholders", async () => {
      // Quando
      await sensorRepository.update("sensor-1", dados);

      // Então
      const [sql, valores] = query.mock.calls[0];
      expect(sql).toContain("unidade_leitura = $3");
      expect(valores).toEqual(["Temperatura", "°C", "K", 1, -273.15, "sensor-1"]);
    });

    it("deve limpar a unidade de leitura quando o valor é null", async () => {
      // Quando
      await sensorRepository.update("sensor-1", { ...dados, unidadeLeitura: null });

      // Então
      expect(query.mock.calls[0][1][2]).toBeNull();
    });
  });
});
