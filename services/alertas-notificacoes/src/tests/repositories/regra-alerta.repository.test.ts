import { pool } from "../../config/db";
import { findSensorComEstacao } from "../../repositories/regra-alerta.repository";

jest.mock("../../config/db", () => ({
  pool: { query: jest.fn() },
}));

const query = jest.mocked(pool.query) as unknown as jest.Mock;

describe("regra-alerta.repository: findSensorComEstacao (US-39)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("deve trazer a faixa física da grandeza por JOIN com o catálogo, numa única consulta", async () => {
    // Dado
    const linha = {
      id: "sensor-1",
      tipo: "Direção do Vento",
      unidade_medida: "°",
      status: "Ativo",
      estacao_id: "estacao-1",
      municipio: "São José dos Campos",
      faixa_min: "0.00",
      faixa_max: "360.00",
    };
    query.mockResolvedValue({ rows: [linha] });

    // Quando
    const sensor = await findSensorComEstacao("sensor-1");

    // Então
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, valores] = query.mock.calls[0];
    expect(sql).toContain("JOIN tipos_sensor t ON t.nome = s.tipo");
    expect(sql).toContain("t.faixa_min");
    expect(sql).toContain("t.faixa_max");
    expect(sql).toContain("s.id = $1");
    expect(valores).toEqual(["sensor-1"]);
    expect(sensor).toEqual(linha);
  });

  it("deve devolver null quando o sensor não existe", async () => {
    // Dado
    query.mockResolvedValue({ rows: [] });

    // Quando / Então
    expect(await findSensorComEstacao("inexistente")).toBeNull();
  });
});
