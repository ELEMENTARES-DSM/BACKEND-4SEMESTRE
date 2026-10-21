import { describe, it, expect, jest } from "@jest/globals";
import { buscarSensoresPorEvento } from "../../repositories/sensor.repository";

describe("sensor.repository", () => {
  it("realiza uma única consulta filtrando por estacao_id e lista de códigos sem duplicatas", async () => {
    const queryMock = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({
      rows: [
        {
          id: "sensor-uuid-1",
          estacao_id: "estacao-uuid-1",
          codigo: "TEMP-01",
          fator: "1.000000",
          ganho: "0.000000",
          status: "Ativo",
          municipio: "São José dos Campos",
        },
      ],
    });

    const mapa = await buscarSensoresPorEvento(
      "estacao-uuid-1",
      ["TEMP-01", "TEMP-01", "UMID-01"],
      { query: queryMock as never },
    );

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("WHERE s.estacao_id = $1"),
      ["estacao-uuid-1", ["TEMP-01", "UMID-01"]],
    );
    expect(mapa.size).toBe(1);
    expect(mapa.get("TEMP-01")?.municipio).toBe("São José dos Campos");
  });

  it("retorna mapa vazio sem consultar o banco quando a lista de códigos está vazia", async () => {
    const queryMock = jest.fn();
    const mapa = await buscarSensoresPorEvento("estacao-uuid-1", [], {
      query: queryMock as never,
    });

    expect(queryMock).not.toHaveBeenCalled();
    expect(mapa.size).toBe(0);
  });

  it("com código repetido na estação (um inativo e um ativo), o Map traz o ativo", async () => {
    // Linhas na ordem em que o ORDER BY (s.status = 'Ativo') ASC as entrega: ativo por último.
    const queryMock = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({
      rows: [
        { id: "sensor-inativo", estacao_id: "estacao-uuid-1", codigo: "PM-01", fator: "1.000000",
          ganho: "0.000000", status: "Inativo", municipio: "São José dos Campos" },
        { id: "sensor-ativo", estacao_id: "estacao-uuid-1", codigo: "PM-01", fator: "1.000000",
          ganho: "0.000000", status: "Ativo", municipio: "São José dos Campos" },
      ],
    });

    const mapa = await buscarSensoresPorEvento("estacao-uuid-1", ["PM-01"], {
      query: queryMock as never,
    });

    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("ORDER BY (s.status = 'Ativo') ASC"),
      ["estacao-uuid-1", ["PM-01"]],
    );
    expect(mapa.size).toBe(1);
    expect(mapa.get("PM-01")).toMatchObject({ id: "sensor-ativo", status: "Ativo" });
  });
});
