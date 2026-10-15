import { describe, it, expect, jest } from "@jest/globals";
import {
  paraUnixtime,
  reservarMensagem,
  DeduplicacaoDeps,
} from "../../services/deduplicacao.service";
import { PayloadLeituraValidado } from "../../dto/mensagem-ingestao.dto";

type InserirSeNova = NonNullable<DeduplicacaoDeps["inserirSeNova"]>;

describe("paraUnixtime", () => {
  it("deve dar o mesmo valor para o mesmo instante em fusos diferentes", () => {
    expect(paraUnixtime("2026-10-13T12:00:00Z")).toBe(
      paraUnixtime("2026-10-13T09:00:00-03:00"),
    );
    expect(paraUnixtime("2026-10-13T12:00:00Z")).toBe(1791892800);
  });

  it("deve dar valores diferentes para horários diferentes", () => {
    expect(paraUnixtime("2026-10-13T12:00:00Z")).not.toBe(
      paraUnixtime("2026-10-13T12:00:01Z"),
    );
  });

  it("deve truncar frações de segundo", () => {
    expect(paraUnixtime("2026-10-13T12:00:00.999Z")).toBe(
      paraUnixtime("2026-10-13T12:00:00Z"),
    );
  });

  it("deve lançar erro para timestamp inválido", () => {
    expect(() => paraUnixtime("nao-e-data")).toThrow(Error);
  });
});

describe("reservarMensagem", () => {
  const estacaoId = "e30a57e3-0d33-4f9e-86b2-6cb1690a7891";
  const payload: PayloadLeituraValidado = {
    timestamp: "2026-10-13T12:00:00.250Z",
    nivel_bateria: 80,
    leituras: [{ sensor: "TMP", valor: 25.4 }],
  };

  it("deve retornar nova com stagingId quando o repository grava", async () => {
    const inserirSeNova = jest.fn<InserirSeNova>().mockResolvedValue("staging-1");

    const res = await reservarMensagem(estacaoId, payload, { inserirSeNova });

    expect(res).toEqual({ nova: true, stagingId: "staging-1" });
    expect(inserirSeNova).toHaveBeenCalledTimes(1);
    expect(inserirSeNova).toHaveBeenCalledWith({
      estacaoId,
      unixtime: 1791892800,
      timestampLeitura: new Date("2026-10-13T12:00:00.250Z"),
      payload,
    });
  });

  it("deve retornar nova: false quando o repository retorna null (duplicata)", async () => {
    const inserirSeNova = jest.fn<InserirSeNova>().mockResolvedValue(null);

    const res = await reservarMensagem(estacaoId, payload, { inserirSeNova });

    expect(res).toEqual({ nova: false });
  });

  it("deve propagar o mesmo erro do repository", async () => {
    const erro = new Error("conexão recusada");
    const inserirSeNova = jest.fn<InserirSeNova>().mockRejectedValue(erro);

    await expect(reservarMensagem(estacaoId, payload, { inserirSeNova })).rejects.toBe(erro);
  });
});
