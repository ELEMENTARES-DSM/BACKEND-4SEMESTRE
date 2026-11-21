import { Logger } from "../../utils/logger";

describe("Logger", () => {
  const logger = new Logger();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("deve formatar e emitir log info com e sem contexto", () => {
    const spy = jest.spyOn(console, "info").mockImplementation(() => undefined);

    logger.info("evento simples");
    logger.info("evento com contexto", { id: 1 });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(JSON.parse(spy.mock.calls[0][0] as string)).toMatchObject({
      nivel: "info",
      mensagem: "evento simples",
    });
    expect(JSON.parse(spy.mock.calls[1][0] as string)).toMatchObject({
      nivel: "info",
      mensagem: "evento com contexto",
      contexto: { id: 1 },
    });
  });

  it("deve emitir log warn e error corretamente", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    logger.warn("alerta", { codigo: "W1" });
    logger.error("erro critico", { detalhe: "falha" });

    expect(JSON.parse(warnSpy.mock.calls[0][0] as string)).toMatchObject({
      nivel: "warn",
      mensagem: "alerta",
      contexto: { codigo: "W1" },
    });
    expect(JSON.parse(errorSpy.mock.calls[0][0] as string)).toMatchObject({
      nivel: "error",
      mensagem: "erro critico",
      contexto: { detalhe: "falha" },
    });
  });
});
