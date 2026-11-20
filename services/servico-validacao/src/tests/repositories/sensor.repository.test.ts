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
          fator_conversao: "1.000000",
          offset: "0.000000",
          status: "Ativo",
          tipo: "Temperatura",
          faixa_min: "-50.00",
          faixa_max: "60.00",
          unidade: "°C",
          municipio: "São José dos Campos",
          estacao_status: "Ativa",
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

  it("deve ler fator_conversao e o offset_calibracao (com o alias entre aspas), sem os nomes antigos (US-39)", async () => {
    // Dado
    const queryMock = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({ rows: [] });

    // Quando
    await buscarSensoresPorEvento("estacao-uuid-1", ["TEMP-01"], { query: queryMock as never });

    // Então: a coluna é offset_calibracao (OFFSET é palavra reservada) e o alias devolve o nome "offset"
    const sql = String(queryMock.mock.calls[0][0]);
    expect(sql).toContain("s.fator_conversao,");
    expect(sql).toContain('s.offset_calibracao AS "offset"');
    expect(sql).not.toContain("AS fator");
    expect(sql).not.toContain("AS ganho");
    expect(sql).not.toContain("s.fator,");
    expect(sql).not.toContain("s.ganho");
  });

  it("deve trazer a faixa física e a unidade da grandeza por JOIN com o catálogo, na mesma consulta (US-39)", async () => {
    // Dado
    const queryMock = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({ rows: [] });

    // Quando
    await buscarSensoresPorEvento("estacao-uuid-1", ["TEMP-01"], { query: queryMock as never });

    // Então: uma consulta só, sem chamada a outro serviço
    expect(queryMock).toHaveBeenCalledTimes(1);
    const sql = String(queryMock.mock.calls[0][0]);
    expect(sql).toContain("JOIN tipos_sensor t ON t.nome = s.tipo");
    expect(sql).toContain("t.faixa_min");
    expect(sql).toContain("t.faixa_max");
    expect(sql).toContain("t.unidade");
  });

  it("deve devolver a faixa do catálogo no mapa, indexada pelo código do sensor", async () => {
    // Dado
    const linha = {
      id: "sensor-uuid-1",
      estacao_id: "estacao-uuid-1",
      codigo: "DIR-01",
      fator_conversao: "1.000000",
      offset: "0.000000",
      status: "Ativo",
      tipo: "Direção do Vento",
      faixa_min: "0.00",
      faixa_max: "360.00",
      unidade: "°",
      municipio: "São José dos Campos",
      estacao_status: "Ativa",
    };
    const queryMock = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({ rows: [linha] });

    // Quando
    const mapa = await buscarSensoresPorEvento("estacao-uuid-1", ["DIR-01"], { query: queryMock as never });

    // Então
    expect(mapa.get("DIR-01")).toMatchObject({ faixa_min: "0.00", faixa_max: "360.00", unidade: "°" });
  });

  it("retorna mapa vazio sem consultar o banco quando a lista de códigos está vazia", async () => {
    const queryMock = jest.fn();
    const mapa = await buscarSensoresPorEvento("estacao-uuid-1", [], {
      query: queryMock as never,
    });

    expect(queryMock).not.toHaveBeenCalled();
    expect(mapa.size).toBe(0);
  });
});
