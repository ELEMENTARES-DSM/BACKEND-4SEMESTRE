import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { Logger, logger } from "../../utils/logger";

// Unitário de Logger: console e relógio mockados.
const AGORA = new Date("2026-11-16T10:00:00.000Z");

describe("Logger", () => {
  let log: Logger;

  beforeEach(() => {
    log = new Logger();
    jest.useFakeTimers().setSystemTime(AGORA);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe.each([
    ["info", "info"],
    ["warn", "warn"],
    ["error", "error"],
  ] as const)("%s", (metodo, saidaConsole) => {
    it(`deve escrever uma linha JSON com nivel '${metodo}', a mensagem e o horário em ISO UTC quando não há contexto`, () => {
      // Dado (Arrange)
      const saida = jest.spyOn(console, saidaConsole).mockImplementation(() => undefined);

      // Quando (Act)
      log[metodo]("Operação concluída");

      // Então (Assert)
      expect(saida).toHaveBeenCalledTimes(1);
      expect(JSON.parse(saida.mock.calls[0][0] as string)).toEqual({
        nivel: metodo,
        mensagem: "Operação concluída",
        timestamp: "2026-11-16T10:00:00.000Z",
      });
    });

    it("deve incluir o contexto na linha quando ele é informado", () => {
      // Dado (Arrange)
      const saida = jest.spyOn(console, saidaConsole).mockImplementation(() => undefined);
      const contexto = { estacaoId: "estacao-01", total: 10 };

      // Quando (Act)
      log[metodo]("Leitura rejeitada", contexto);

      // Então (Assert)
      expect(JSON.parse(saida.mock.calls[0][0] as string).contexto).toEqual(contexto);
    });
  });
});

describe("logger", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("deve escrever pela instância exportada quando o serviço usa o logger padrão", () => {
    // Dado (Arrange)
    const saida = jest.spyOn(console, "info").mockImplementation(() => undefined);

    // Quando (Act)
    logger.info("Teste via singleton");

    // Então (Assert)
    expect(JSON.parse(saida.mock.calls[0][0] as string).mensagem).toBe("Teste via singleton");
  });
});
