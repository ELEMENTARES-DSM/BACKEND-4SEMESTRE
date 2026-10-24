import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { RepublicadorAlarmes } from "../../services/republicar-alarmes.service";
import { AlarmeRow } from "../../dto/alarme.dto";
import logger from "../../utils/logger";

const alarme = (id: string) => ({ id }) as AlarmeRow;

describe("RepublicadorAlarmes (US-22)", () => {
  const agora = new Date("2026-10-24T13:10:00.000Z");
  let publicar: jest.Mock<(alarmes: AlarmeRow[]) => Promise<void>>;
  let buscarPendentes: jest.Mock<(limite: number) => Promise<AlarmeRow[]>>;
  let marcarPublicados: jest.Mock<(ids: string[], publicadoEm: Date) => Promise<void>>;

  const criar = (lote = 2) =>
    new RepublicadorAlarmes({ publicar, buscarPendentes, marcarPublicados, agora: () => agora, esperaMs: 5000, lote });

  beforeEach(() => {
    jest.spyOn(logger, "info").mockImplementation(() => undefined);
    jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    publicar = jest.fn<(alarmes: AlarmeRow[]) => Promise<void>>().mockResolvedValue(undefined);
    buscarPendentes = jest.fn<(limite: number) => Promise<AlarmeRow[]>>().mockResolvedValue([]);
    marcarPublicados = jest.fn<(ids: string[], publicadoEm: Date) => Promise<void>>().mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("sem pendentes não publica nada", async () => {
    await criar().executar();

    expect(publicar).not.toHaveBeenCalled();
    expect(buscarPendentes).toHaveBeenCalledWith(2);
  });

  it("publica os pendentes em lotes, mais antigos primeiro, e marca cada lote como publicado", async () => {
    buscarPendentes
      .mockResolvedValueOnce([alarme("a-1"), alarme("a-2")])
      .mockResolvedValueOnce([alarme("a-3")]);

    await criar(2).executar();

    expect(publicar.mock.calls.map(([lote]) => lote.map((a) => a.id))).toEqual([["a-1", "a-2"], ["a-3"]]);
    expect(marcarPublicados.mock.calls).toEqual([
      [["a-1", "a-2"], agora],
      [["a-3"], agora],
    ]);
  });

  it("falha na publicação não marca nada e agenda nova tentativa depois da espera", async () => {
    jest.useFakeTimers();
    buscarPendentes.mockResolvedValue([alarme("a-1")]);
    publicar.mockRejectedValueOnce(new Error("RabbitMQ fora")).mockResolvedValue(undefined);
    const republicador = criar(10);

    await republicador.executar();
    expect(marcarPublicados).not.toHaveBeenCalled();

    buscarPendentes.mockResolvedValueOnce([alarme("a-1")]).mockResolvedValue([]);
    await jest.advanceTimersByTimeAsync(5000);

    expect(marcarPublicados).toHaveBeenCalledWith(["a-1"], agora);
    republicador.encerrar();
  });

  it("duas chamadas ao mesmo tempo fazem uma execução só", async () => {
    let liberar!: () => void;
    buscarPendentes.mockImplementationOnce(
      () => new Promise<AlarmeRow[]>((resolve) => { liberar = () => resolve([]); }),
    );
    const republicador = criar();

    const primeira = republicador.executar();
    const segunda = republicador.executar();
    liberar();
    await Promise.all([primeira, segunda]);

    expect(buscarPendentes).toHaveBeenCalledTimes(1);
  });

  it("agendar dispara uma execução e depois de encerrar não agenda mais", async () => {
    jest.useFakeTimers();
    const republicador = criar();

    republicador.agendar();
    republicador.agendar();
    await jest.advanceTimersByTimeAsync(0);
    expect(buscarPendentes).toHaveBeenCalledTimes(1);

    republicador.encerrar();
    republicador.agendar();
    await jest.advanceTimersByTimeAsync(10000);
    expect(buscarPendentes).toHaveBeenCalledTimes(1);
  });
});
