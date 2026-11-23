import { extrairUuidEstacaoDoTopico } from "../../utils/topic-parser";
import {
  ErroConsultaEstacao,
  validarEstacaoDoTopico,
  validarEstacaoPorId,
} from "../../services/validacao-estacao.service";
import { processarLeitura } from "../../services/processamento-leitura.service";

const UUID_VALIDO = "e0000000-0000-4000-8000-000000000001";

describe("topic-parser, validacao-estacao.service e processamento-leitura.service", () => {
  const fetchOriginal = global.fetch;

  afterEach(() => {
    global.fetch = fetchOriginal;
    delete process.env.GESTAO_ESTACOES_TOKEN;
    jest.restoreAllMocks();
  });

  describe("extrairUuidEstacaoDoTopico", () => {
    it("deve extrair UUID em minúsculas quando o tópico é válido", () => {
      expect(extrairUuidEstacaoDoTopico(`leituras.${UUID_VALIDO.toUpperCase()}`)).toBe(UUID_VALIDO);
    });

    it("deve retornar null para tópicos com prefixo, formato ou UUID inválido", () => {
      expect(extrairUuidEstacaoDoTopico("outro.e0000000-0000-4000-8000-000000000001")).toBeNull();
      expect(extrairUuidEstacaoDoTopico("leituras")).toBeNull();
      expect(extrairUuidEstacaoDoTopico("leituras.nao-e-uuid")).toBeNull();
    });
  });

  describe("validarEstacaoDoTopico", () => {
    it("deve retornar TOPICO_INVALIDO quando o tópico não contém UUID válido", async () => {
      await expect(validarEstacaoDoTopico("invalido")).resolves.toEqual({
        valido: false,
        motivo: "TOPICO_INVALIDO",
      });
    });

    it("deve delegar para validarEstacaoPorId quando o tópico é válido", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({ id: UUID_VALIDO, status: "Ativa" }),
      }) as unknown as typeof fetch;

      await expect(
        validarEstacaoDoTopico(`leituras.${UUID_VALIDO}`, { token: "tok", baseUrl: "http://estacoes/" })
      ).resolves.toEqual({ valido: true, estacaoId: UUID_VALIDO });
    });
  });

  describe("validarEstacaoPorId", () => {
    it("deve retornar Estação desconhecida para UUID inválido", async () => {
      await expect(validarEstacaoPorId("abc")).resolves.toEqual({
        valido: false,
        motivo: "Estação desconhecida",
      });
    });

    it("deve lançar ErroConsultaEstacao quando token não está configurado", async () => {
      await expect(validarEstacaoPorId(UUID_VALIDO)).rejects.toThrow(ErroConsultaEstacao);
    });

    it("deve retornar Estação desconhecida quando serviço responde 404", async () => {
      global.fetch = jest.fn().mockResolvedValue({ status: 404, ok: false }) as unknown as typeof fetch;

      await expect(validarEstacaoPorId(UUID_VALIDO, { token: "tok" })).resolves.toEqual({
        valido: false,
        motivo: "Estação desconhecida",
      });
    });

    it("deve lançar ErroConsultaEstacao com statusCode quando serviço responde 500", async () => {
      global.fetch = jest.fn().mockResolvedValue({ status: 500, ok: false }) as unknown as typeof fetch;

      await expect(validarEstacaoPorId(UUID_VALIDO, { token: "tok" })).rejects.toMatchObject({
        name: "ErroConsultaEstacao",
        statusCode: 500,
      });
    });

    it("deve lançar ErroConsultaEstacao quando payload de resposta é inválido", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({ id: "outro", status: "Desconhecido" }),
      }) as unknown as typeof fetch;

      await expect(validarEstacaoPorId(UUID_VALIDO, { token: "tok" })).rejects.toThrow(
        "Resposta inválida de gestão de estações"
      );
    });

    it("deve retornar Estação inativa quando status é Inativa", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({ id: UUID_VALIDO, status: "Inativa" }),
      }) as unknown as typeof fetch;

      await expect(validarEstacaoPorId(UUID_VALIDO, { token: "tok" })).resolves.toEqual({
        valido: false,
        motivo: "Estação inativa",
      });
    });

    it("deve aceitar estação com status Com Falha", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({ id: UUID_VALIDO, status: "Com Falha" }),
      }) as unknown as typeof fetch;

      await expect(validarEstacaoPorId(UUID_VALIDO, { token: "tok" })).resolves.toEqual({
        valido: true,
        estacaoId: UUID_VALIDO,
      });
    });

    it("deve lançar ErroConsultaEstacao em caso de falha de rede", async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;

      await expect(validarEstacaoPorId(UUID_VALIDO, { token: "tok" })).rejects.toThrow(
        "Erro de comunicação com gestão de estações"
      );
    });
  });

  describe("processarLeitura", () => {
    it("deve entregar para US-13 quando estação é válida e não entregar quando inválida", async () => {
      const entregar = jest.fn().mockResolvedValue(undefined);
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({ id: UUID_VALIDO, status: "Ativa" }),
      }) as unknown as typeof fetch;

      const msgValida = { estacaoId: UUID_VALIDO, payloadBruto: "{}", recebidoEm: "2026-10-01T00:00:00Z" };
      const resValido = await processarLeitura(msgValida, entregar, { token: "tok" });
      expect(resValido.valido).toBe(true);
      expect(entregar).toHaveBeenCalledWith(msgValida);

      entregar.mockClear();
      const resInvalido = await processarLeitura(
        { estacaoId: "invalido", payloadBruto: "{}", recebidoEm: "2026-10-01T00:00:00Z" },
        entregar
      );
      expect(resInvalido.valido).toBe(false);
      expect(entregar).not.toHaveBeenCalled();
    });
  });
});
