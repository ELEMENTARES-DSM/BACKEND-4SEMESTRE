import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { pool } from "../../config/db";
import { inserirStaging, RegistroStaging } from "../../repositories/staging.repository";

// Unitário de inserirStaging: o PostgreSQL é mockado.
const registro: RegistroStaging = {
  id: "11111111-1111-4111-8111-111111111111",
  estacaoId: "e30a57e3-0d33-4f9e-86b2-6cb1690a7891",
  unixtime: 1792400000,
  recebidoEm: "2026-10-16T10:00:00.000Z",
  payloadBruto: "{}",
  payloadJson: "{}",
  status: "recebida",
  motivoRejeicao: null,
};

describe("inserirStaging", () => {
  let consulta: jest.SpiedFunction<typeof pool.query>;

  beforeEach(() => {
    consulta = jest.spyOn(pool, "query");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("deve inserir com o id do Valkey e devolver true quando não há conflito", async () => {
    // Dado (Arrange)
    consulta.mockResolvedValueOnce({ rows: [{ id: registro.id }] } as never);

    // Quando (Act)
    const gravou = await inserirStaging(registro);

    // Então (Assert)
    expect(gravou).toBe(true);
    expect(consulta).toHaveBeenCalledTimes(1);
    expect(consulta.mock.calls[0][0]).toContain("ON CONFLICT DO NOTHING");
    expect((consulta.mock.calls[0][1] as unknown[])[0]).toBe(registro.id);
  });

  it("deve devolver false quando há conflito e a linha existente é de outra mensagem (duplicata)", async () => {
    // Dado (Arrange)
    consulta.mockResolvedValueOnce({ rows: [] } as never).mockResolvedValueOnce({ rows: [] } as never);

    // Quando (Act)
    const gravou = await inserirStaging(registro);

    // Então (Assert)
    expect(gravou).toBe(false);
    expect(consulta.mock.calls[1]).toEqual(["SELECT 1 FROM staging_telemetria WHERE id = $1", [registro.id]]);
  });

  it("deve devolver true quando a mesma mensagem do Valkey já tinha sido gravada (verificada de novo)", async () => {
    // Dado (Arrange)
    consulta.mockResolvedValueOnce({ rows: [] } as never).mockResolvedValueOnce({ rows: [{ "?column?": 1 }] } as never);

    // Quando (Act)
    const gravou = await inserirStaging(registro);

    // Então (Assert)
    expect(gravou).toBe(true);
  });

  it("deve usar o cliente da transação quando ele é informado", async () => {
    // Dado (Arrange)
    const client = { query: jest.fn<() => Promise<unknown>>().mockResolvedValue({ rows: [{ id: registro.id }] }) };

    // Quando (Act)
    await inserirStaging(registro, client as never);

    // Então (Assert)
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(consulta).not.toHaveBeenCalled();
  });
});
