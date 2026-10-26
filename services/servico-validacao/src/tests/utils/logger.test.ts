import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { Logger, logger } from "../../utils/logger";

describe("Logger", () => {
  let log: Logger;

  beforeEach(() => {
    log = new Logger();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("info", () => {
    it("deve gerar uma linha JSON válida com nivel 'info', mensagem e timestamp em ISO UTC sem contexto", () => {
      const spy = jest.spyOn(console, "info").mockImplementation(() => {});

      const mensagem = "Operação concluída com sucesso";
      log.info(mensagem);

      expect(spy).toHaveBeenCalledTimes(1);
      const saida = spy.mock.calls[0][0] as string;
      const parsed = JSON.parse(saida);

      expect(parsed.nivel).toBe("info");
      expect(parsed.mensagem).toBe(mensagem);
      expect(typeof parsed.timestamp).toBe("string");
      expect(new Date(parsed.timestamp).toISOString()).toBe(parsed.timestamp);
      expect(parsed.contexto).toBeUndefined();
    });

    it("deve incluir o contexto quando fornecido", () => {
      const spy = jest.spyOn(console, "info").mockImplementation(() => {});

      const mensagem = "Processamento iniciado";
      const contexto = { stagingId: "12345", leituras: 5 };
      log.info(mensagem, contexto);

      expect(spy).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(spy.mock.calls[0][0] as string);

      expect(parsed.nivel).toBe("info");
      expect(parsed.mensagem).toBe(mensagem);
      expect(parsed.contexto).toEqual(contexto);
    });
  });

  describe("warn", () => {
    it("deve gerar uma linha JSON válida com nivel 'warn', mensagem e timestamp em ISO UTC sem contexto", () => {
      const spy = jest.spyOn(console, "warn").mockImplementation(() => {});

      const mensagem = "Divergência detectada em leitura duplicada";
      log.warn(mensagem);

      expect(spy).toHaveBeenCalledTimes(1);
      const saida = spy.mock.calls[0][0] as string;
      const parsed = JSON.parse(saida);

      expect(parsed.nivel).toBe("warn");
      expect(parsed.mensagem).toBe(mensagem);
      expect(typeof parsed.timestamp).toBe("string");
      expect(new Date(parsed.timestamp).toISOString()).toBe(parsed.timestamp);
      expect(parsed.contexto).toBeUndefined();
    });

    it("deve incluir o contexto quando fornecido", () => {
      const spy = jest.spyOn(console, "warn").mockImplementation(() => {});

      const mensagem = "Divergência detectada";
      const contexto = { sensorId: "sensor-01", unixtime: 1792400000 };
      log.warn(mensagem, contexto);

      expect(spy).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(spy.mock.calls[0][0] as string);

      expect(parsed.nivel).toBe("warn");
      expect(parsed.mensagem).toBe(mensagem);
      expect(parsed.contexto).toEqual(contexto);
    });
  });

  describe("error", () => {
    it("deve gerar uma linha JSON válida com nivel 'error', mensagem e timestamp em ISO UTC sem contexto", () => {
      const spy = jest.spyOn(console, "error").mockImplementation(() => {});

      const mensagem = "Falha crítica ao conectar no RabbitMQ";
      log.error(mensagem);

      expect(spy).toHaveBeenCalledTimes(1);
      const saida = spy.mock.calls[0][0] as string;
      const parsed = JSON.parse(saida);

      expect(parsed.nivel).toBe("error");
      expect(parsed.mensagem).toBe(mensagem);
      expect(typeof parsed.timestamp).toBe("string");
      expect(new Date(parsed.timestamp).toISOString()).toBe(parsed.timestamp);
      expect(parsed.contexto).toBeUndefined();
    });

    it("deve incluir o contexto quando fornecido", () => {
      const spy = jest.spyOn(console, "error").mockImplementation(() => {});

      const mensagem = "Exceção na transação";
      const contexto = { erro: "Connection refused", codigo: 500 };
      log.error(mensagem, contexto);

      expect(spy).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(spy.mock.calls[0][0] as string);

      expect(parsed.nivel).toBe("error");
      expect(parsed.mensagem).toBe(mensagem);
      expect(parsed.contexto).toEqual(contexto);
    });
  });

  describe("instância padrão singleton logger", () => {
    it("deve emitir através do singleton exportado", () => {
      const spy = jest.spyOn(console, "info").mockImplementation(() => {});
      logger.info("Teste via singleton");
      expect(spy).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(spy.mock.calls[0][0] as string);
      expect(parsed.mensagem).toBe("Teste via singleton");
    });
  });
});
