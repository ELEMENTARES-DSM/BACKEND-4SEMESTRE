import { describe, it, expect, jest } from "@jest/globals";
import {
  encaminharSeNova,
  FluxoIngestaoDeps,
  SeguirParaUS14,
} from "../../services/fluxo-ingestao.service";
import { PayloadLeituraValidado } from "../../dto/mensagem-ingestao.dto";

type Reservar = NonNullable<FluxoIngestaoDeps["reservar"]>;
type Remover = NonNullable<FluxoIngestaoDeps["remover"]>;

describe("encaminharSeNova", () => {
  const estacaoId = "e30a57e3-0d33-4f9e-86b2-6cb1690a7891";
  const payload: PayloadLeituraValidado = {
    timestamp: "2026-10-13T12:00:00Z",
    leituras: [{ sensor: "TMP", valor: 25.4 }],
  };

  it("deve chamar seguirParaUS14 exatamente 1 vez quando a mensagem é nova", async () => {
    const seguirParaUS14 = jest.fn<SeguirParaUS14>().mockResolvedValue(undefined);
    const reservar = jest
      .fn<Reservar>()
      .mockResolvedValue({ nova: true, stagingId: "staging-1" });
    const remover = jest.fn<Remover>();

    const res = await encaminharSeNova(estacaoId, payload, {
      seguirParaUS14,
      reservar,
      remover,
    });

    expect(res).toEqual({ resultado: "nova", stagingId: "staging-1" });
    expect(remover).not.toHaveBeenCalled();
    expect(reservar).toHaveBeenCalledWith(estacaoId, payload);
    expect(seguirParaUS14).toHaveBeenCalledTimes(1);
    expect(seguirParaUS14).toHaveBeenCalledWith({
      estacaoId,
      stagingId: "staging-1",
      payload,
    });
  });

  it("não deve chamar seguirParaUS14 quando a mensagem é duplicada", async () => {
    const seguirParaUS14 = jest.fn<SeguirParaUS14>();
    const reservar = jest.fn<Reservar>().mockResolvedValue({ nova: false });
    const remover = jest.fn<Remover>();

    const res = await encaminharSeNova(estacaoId, payload, {
      seguirParaUS14,
      reservar,
      remover,
    });

    expect(res).toEqual({ resultado: "duplicada" });
    expect(seguirParaUS14).not.toHaveBeenCalled();
    expect(remover).not.toHaveBeenCalled();
  });

  it("deve remover a reserva e propagar o erro original quando seguirParaUS14 falha", async () => {
    const erroUS14 = new Error("falha na US-14");
    const seguirParaUS14 = jest.fn<SeguirParaUS14>().mockRejectedValue(erroUS14);
    const reservar = jest
      .fn<Reservar>()
      .mockResolvedValue({ nova: true, stagingId: "staging-1" });
    const remover = jest.fn<Remover>().mockResolvedValue(undefined);

    await expect(
      encaminharSeNova(estacaoId, payload, { seguirParaUS14, reservar, remover }),
    ).rejects.toBe(erroUS14);
    expect(remover).toHaveBeenCalledTimes(1);
    expect(remover).toHaveBeenCalledWith("staging-1");
  });

  it("deve propagar o erro da US-14 mesmo quando a remoção da reserva também falha", async () => {
    const erroUS14 = new Error("falha na US-14");
    const seguirParaUS14 = jest.fn<SeguirParaUS14>().mockRejectedValue(erroUS14);
    const reservar = jest
      .fn<Reservar>()
      .mockResolvedValue({ nova: true, stagingId: "staging-1" });
    const remover = jest.fn<Remover>().mockRejectedValue(new Error("falha na remoção"));

    await expect(
      encaminharSeNova(estacaoId, payload, { seguirParaUS14, reservar, remover }),
    ).rejects.toBe(erroUS14);
    expect(remover).toHaveBeenCalledTimes(1);
  });

  it("não deve chamar seguirParaUS14 e deve propagar o erro quando a reserva falha", async () => {
    const erro = new Error("falha no banco");
    const seguirParaUS14 = jest.fn<SeguirParaUS14>();
    const reservar = jest.fn<Reservar>().mockRejectedValue(erro);

    await expect(
      encaminharSeNova(estacaoId, payload, { seguirParaUS14, reservar }),
    ).rejects.toBe(erro);
    expect(seguirParaUS14).not.toHaveBeenCalled();
  });
});
