import { describe, it, expect, jest, afterEach } from "@jest/globals";
import {
  registrarDuplicadaIgnorada,
  MENSAGEM_DUPLICADA_IGNORADA,
} from "../../services/registro-duplicada.service";
import { logger } from "../../utils/logger";

// Unitário de registrarDuplicadaIgnorada: log injetado como mock. O contador
// de duplicadas fica no Valkey (staging-valkey.repository).
describe("registrarDuplicadaIgnorada", () => {
  const dados = { estacaoId: "e30a57e3-0d33-4f9e-86b2-6cb1690a7891", timestamp: "2026-10-14T12:00:00Z" };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("deve emitir INFO uma vez com a mensagem e o contexto exatos quando a duplicata é ignorada", () => {
    // Dado (Arrange)
    const mockLogger = { info: jest.fn() };

    // Quando (Act)
    registrarDuplicadaIgnorada(dados, { logger: mockLogger });

    // Então (Assert)
    expect(mockLogger.info).toHaveBeenCalledTimes(1);
    expect(mockLogger.info).toHaveBeenCalledWith(MENSAGEM_DUPLICADA_IGNORADA, dados);
  });

  it("deve não emitir WARN nem ERROR quando a duplicata é ignorada, porque duplicata não é erro", () => {
    // Dado (Arrange)
    const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

    // Quando (Act)
    registrarDuplicadaIgnorada(dados, { logger: mockLogger });

    // Então (Assert)
    expect(mockLogger.warn).not.toHaveBeenCalled();
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("deve usar o logger padrão quando as dependências não são informadas", () => {
    // Dado (Arrange)
    const info = jest.spyOn(logger, "info").mockImplementation(() => undefined);

    // Quando (Act)
    registrarDuplicadaIgnorada(dados);

    // Então (Assert)
    expect(info).toHaveBeenCalledWith(MENSAGEM_DUPLICADA_IGNORADA, dados);
  });
});
