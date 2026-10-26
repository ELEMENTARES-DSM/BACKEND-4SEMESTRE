import { describe, it, expect, jest } from "@jest/globals";
import {
  inserirAlarmeAberto,
  normalizarAlarmeAberto,
  normalizarAlarmesDeRegrasInativas,
} from "../../repositories/alarme.repository";

describe("alarme.repository (US-22)", () => {
  const lidoEm = new Date("2026-10-24T13:00:00.000Z");
  const agora = new Date("2026-10-24T13:00:01.000Z");

  const dados = {
    regra_id: "regra-1",
    medida_id: "medida-1",
    sensor_id: "sensor-1",
    estacao_id: "estacao-1",
    municipio: "São José dos Campos",
    valor: "52.30",
    operador: ">=" as const,
    limite: "50.00",
    severidade: "CRITICO" as const,
    lido_em: lidoEm,
    criado_em: agora,
  };

  it("grava o alarme aberto com ON CONFLICT DO NOTHING e devolve a linha criada", async () => {
    const linha = { id: "alarme-1", ...dados, situacao: "aberto" };
    const query = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({ rows: [linha] });

    const alarme = await inserirAlarmeAberto(dados, { query: query as never });

    expect(alarme).toEqual(linha);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("INSERT INTO alarmes");
    expect(sql).toContain("ON CONFLICT DO NOTHING");
    expect(params).toEqual([
      "regra-1",
      "medida-1",
      "sensor-1",
      "estacao-1",
      "São José dos Campos",
      "52.30",
      ">=",
      "50.00",
      "CRITICO",
      "2026-10-24T13:00:00.000Z",
      "2026-10-24T13:00:01.000Z",
    ]);
  });

  it("devolve null quando o banco recusa por já existir alarme da regra (aberto ou da mesma medida)", async () => {
    const query = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({ rows: [] });

    expect(await inserirAlarmeAberto(dados, { query: query as never })).toBeNull();
  });

  it("normaliza só o alarme aberto da regra com leitura igual ou mais antiga", async () => {
    const query = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue({ rows: [{ id: "alarme-1", regra_id: "regra-1" }] });

    const normalizado = await normalizarAlarmeAberto("regra-1", lidoEm, agora, { query: query as never });

    expect(normalizado).toEqual({ id: "alarme-1", regra_id: "regra-1" });
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("situacao = 'aberto' AND lido_em <= $2");
    expect(params).toEqual(["regra-1", "2026-10-24T13:00:00.000Z", "2026-10-24T13:00:01.000Z"]);
  });

  it("normaliza os alarmes abertos de regras inativas dos sensores informados", async () => {
    const query = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue({ rows: [{ id: "alarme-2", regra_id: "regra-2" }] });

    const normalizados = await normalizarAlarmesDeRegrasInativas(["sensor-1"], agora, { query: query as never });

    expect(normalizados).toEqual([{ id: "alarme-2", regra_id: "regra-2" }]);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("NOT EXISTS");
    expect(sql).toContain("r.esta_ativo");
    expect(params).toEqual([["sensor-1"], "2026-10-24T13:00:01.000Z"]);
  });

  it("sem sensores não consulta o banco", async () => {
    const query = jest.fn();

    expect(await normalizarAlarmesDeRegrasInativas([], agora, { query: query as never })).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
