import { describe, it, expect, jest } from "@jest/globals";
import { buscarRegrasAtivasPorSensores } from "../../repositories/regra-alerta.repository";

describe("regra-alerta.repository (US-22)", () => {
  it("busca numa única consulta só as regras ativas dos sensores, sem repetir sensor", async () => {
    const regras = [{ id: "regra-1", sensor_id: "sensor-1", operador: ">=", valor_limite: "50.00", severidade: "CRITICO" }];
    const query = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({ rows: regras });

    const resultado = await buscarRegrasAtivasPorSensores(["sensor-1", "sensor-1", "sensor-2"], {
      query: query as never,
    });

    expect(resultado).toEqual(regras);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("FROM regras_alerta");
    expect(sql).toContain("AND esta_ativo");
    expect(sql).not.toMatch(/INSERT|UPDATE|DELETE/);
    expect(params).toEqual([["sensor-1", "sensor-2"]]);
  });

  it("sem sensores não consulta o banco", async () => {
    const query = jest.fn();

    expect(await buscarRegrasAtivasPorSensores([], { query: query as never })).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
