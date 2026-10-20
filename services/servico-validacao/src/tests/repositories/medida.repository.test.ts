import { describe, it, expect, jest } from "@jest/globals";
import { inserirMedidaIdempotente } from "../../repositories/medida.repository";

describe("medida.repository", () => {
  const baseInput = {
    sensor_id: "sensor-1",
    unixtime: 1792400000,
    valor_bruto: "25.400000",
    valor: "25.40",
    valida: true,
    staging_id: "staging-1",
    criado_em: new Date("2026-10-20T12:00:00.000Z"),
  };

  it("retorna inserida=true quando o INSERT não sofre conflito", async () => {
    const linhaInserida = {
      id: "medida-1",
      sensor_id: "sensor-1",
      unixtime: "1792400000",
      valor_bruto: "25.400000",
      valor: "25.400000",
      valida: true,
      staging_id: "staging-1",
      criado_em: new Date("2026-10-20T12:00:00.000Z"),
    };

    const queryMock = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValueOnce({
      rows: [linhaInserida],
    });

    const resultado = await inserirMedidaIdempotente(baseInput, {
      query: queryMock as never,
    });

    expect(resultado).toEqual({
      inserida: true,
      medida: linhaInserida,
    });
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT (sensor_id, unixtime) DO NOTHING"),
      [
        "sensor-1",
        1792400000,
        "25.400000",
        "25.40",
        true,
        "staging-1",
        "2026-10-20T12:00:00.000Z",
      ],
    );
  });

  it("retorna inserida=false e busca a linha existente quando ocorre conflito de idempotência", async () => {
    const linhaExistente = {
      id: "medida-original",
      sensor_id: "sensor-1",
      unixtime: "1792400000",
      valor_bruto: "24.900000",
      valor: "24.900000",
      valida: true,
      staging_id: "staging-original",
      criado_em: new Date("2026-10-20T11:59:00.000Z"),
    };

    const queryMock = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [linhaExistente] });

    const resultado = await inserirMedidaIdempotente(baseInput, {
      query: queryMock as never,
    });

    expect(resultado).toEqual({
      inserida: false,
      medida: linhaExistente,
    });
    expect(queryMock).toHaveBeenCalledTimes(2);
  });
});
