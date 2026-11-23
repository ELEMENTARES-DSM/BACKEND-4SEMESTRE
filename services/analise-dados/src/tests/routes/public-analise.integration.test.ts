import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  jest,
} from "@jest/globals";
import request from "supertest";
import app from "../../app";
import { pool } from "../../config/db";

jest.mock("../../config/db", () => ({
  pool: {
    query: jest.fn(),
  },
}));

const mockQuery = pool.query as unknown as jest.Mock;
const JWT_SECRET = process.env.JWT_SECRET || "test-secret";

describe("analise.routes (US-35)", () => {
  beforeAll(() => {
    process.env.JWT_SECRET = JWT_SECRET;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /analise/publico/:municipio/estacoes/:codigo/series", () => {
    it("deve retornar 200 OK sem token quando a estação ativa pertence ao município e o período é 24h", async () => {
      // Dado: estação ativa no município e medidas válidas agregadas em 5 minutos
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: "e0000000-0000-4000-8000-000000000001",
              codigo: "EST-01",
              municipio: "sjc",
            },
          ],
        } as never)
        .mockResolvedValueOnce({
          rows: [
            {
              bucket_brt: "2026-06-06T10:00:00",
              media_valor: "25.40",
            },
          ],
        } as never);

      // Quando: usuário anônimo consulta a série pública de 24h sem Authorization
      const response = await request(app).get(
        "/analise/publico/sjc/estacoes/EST-01/series?grandeza=PM25&periodo=24h",
      );

      // Então: responde 200 OK filtrando estação ativa, município e valida = true em uma única consulta de estação
      expect(response.status).toBe(200);
      expect(mockQuery).toHaveBeenCalledTimes(2);
      const sqlEstacao = mockQuery.mock.calls[0][0] as string;
      const sqlMedidas = mockQuery.mock.calls[1][0] as string;
      expect(sqlEstacao).toContain("status = 'Ativa'");
      expect(sqlEstacao).toContain("UPPER(municipio) = UPPER($2)");
      expect(sqlMedidas).toContain("m.valida = true");
      expect(response.body).toEqual({
        estacaoId: "EST-01",
        grandeza: "PM25",
        periodo: "24h",
        dados: [{ timestamp: "2026-06-06T10:00:00-03:00", valor: 25.4 }],
      });
    });

    it("deve retornar 200 OK sem token quando o período está exatamente no limite público de 7d", async () => {
      // Dado: estação ativa no município e série horária de 7 dias
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: "e0000000-0000-4000-8000-000000000001",
              codigo: "EST-01",
              municipio: "sjc",
            },
          ],
        } as never)
        .mockResolvedValueOnce({
          rows: [
            {
              bucket_brt: "2026-06-06T11:00:00",
              media_valor: "18.75",
            },
          ],
        } as never);

      // Quando: usuário anônimo solicita exatamente 7d (borda superior permitida)
      const response = await request(app).get(
        "/analise/publico/sjc/estacoes/EST-01/series?grandeza=PM25&periodo=7d",
      );

      // Então: aceita e devolve 200 OK
      expect(response.status).toBe(200);
      expect(response.body.periodo).toBe("7d");
      expect(response.body.dados).toHaveLength(1);
    });

    it("deve retornar 400 Bad Request quando usuário anônimo solicita período acima de 7 dias (30d)", async () => {
      // Dado: requisição anônima solicitando 30d (logo acima do limite público de 7d)
      // Quando: chama a rota pública de séries com periodo=30d
      const response = await request(app).get(
        "/analise/publico/sjc/estacoes/EST-01/series?grandeza=PM25&periodo=30d",
      );

      // Então: o middleware verificarPeriodo bloqueia antes de consultar o banco
      expect(response.status).toBe(400);
      expect(response.body.erro).toContain("7 dias");
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it("deve retornar 400 Bad Request quando o parâmetro grandeza não é enviado", async () => {
      // Dado: requisição sem parâmetro obrigatório grandeza
      // Quando: chama a rota pública de séries omitindo grandeza
      const response = await request(app).get(
        "/analise/publico/sjc/estacoes/EST-01/series?periodo=24h",
      );

      // Então: retorna 400 sem consultar o banco
      expect(response.status).toBe(400);
      expect(response.body.statusCode).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it("deve retornar 404 Not Found quando a estação está inativa ou não pertence ao município informado", async () => {
      // Dado: banco não retorna estação ativa pertencente ao município solicitado
      mockQuery.mockResolvedValueOnce({ rows: [] } as never);

      // Quando: consulta séries para estação inativa ou de outro município
      const response = await request(app).get(
        "/analise/publico/jacarei/estacoes/EST-01/series?grandeza=PM25&periodo=24h",
      );

      // Então: retorna 404 padronizado
      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        statusCode: 404,
        message: "Estação não encontrada.",
      });
    });

    it("deve retornar 401 Unauthorized quando um token Bearer inválido é enviado na rota pública", async () => {
      // Dado: header Authorization com token inválido
      // Quando: envia requisição para a rota pública passando pelo middleware authOpcional
      const response = await request(app)
        .get(
          "/analise/publico/sjc/estacoes/EST-01/series?grandeza=PM25&periodo=24h",
        )
        .set("Authorization", "Bearer token-invalido");

      // Então: authOpcional rejeita o token inválido com 401
      expect(response.status).toBe(401);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it("deve retornar 500 genérico sem vazar detalhes internos quando ocorre erro inesperado no banco", async () => {
      // Dado: falha inesperada de conexão no PostgreSQL
      const consoleErrorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      mockQuery.mockRejectedValueOnce(new Error("password authentication failed") as never);

      // Quando: consulta a rota pública de séries
      const response = await request(app).get(
        "/analise/publico/sjc/estacoes/EST-01/series?grandeza=PM25&periodo=24h",
      );

      // Então: responde 500 genérico sem expor a mensagem interna do erro
      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        statusCode: 500,
        message: "Internal Server Error",
      });
      consoleErrorSpy.mockRestore();
    });
  });

  describe("GET /analise/publico/:municipio/estacoes/:codigo/ultimas-leituras", () => {
    it("deve retornar 200 OK sem token respeitando catálogo dinâmico sem fallback fixo de unidade quando a estação está ativa", async () => {
      // Dado: estação ativa no município com grandeza dinâmica e outra grandeza sem unidade
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: "e0000000-0000-4000-8000-000000000001",
              codigo: "EST-01",
              municipio: "sjc",
            },
          ],
        } as never)
        .mockResolvedValueOnce({
          rows: [
            {
              grandeza: "Temperatura",
              valor_calibrado: 24.5,
              valor: 24.5,
              unidade: "°C",
              timestamp_leitura: new Date(),
            },
            {
              grandeza: "IndiceUV",
              valor_calibrado: 6,
              valor: 6,
              unidade: null,
              timestamp_leitura: new Date(),
            },
          ],
        } as never);

      // Quando: usuário anônimo consulta as últimas leituras públicas
      const response = await request(app).get(
        "/analise/publico/sjc/estacoes/EST-01/ultimas-leituras",
      );

      // Então: retorna 200 com LEFT JOIN tipos_sensor, status = 'Ativa', valida = true e sem fallback 'µg/m³'
      expect(response.status).toBe(200);
      const sqlEstacao = mockQuery.mock.calls[0][0] as string;
      const sqlMedidas = mockQuery.mock.calls[1][0] as string;
      expect(sqlEstacao).toContain("status = 'Ativa'");
      expect(sqlMedidas).toContain("LEFT JOIN tipos_sensor");
      expect(sqlMedidas).toContain("m.valida = true");
      expect(response.body).toEqual({
        estacaoId: "EST-01",
        leituras: [
          {
            grandeza: "Temperatura",
            valorCalibrado: 24.5,
            unidade: "°C",
            tempoRelativo: "agora mesmo",
          },
          {
            grandeza: "IndiceUV",
            valorCalibrado: 6,
            unidade: "",
            tempoRelativo: "agora mesmo",
          },
        ],
      });
    });

    it("deve retornar 404 Not Found quando a estação está inativa ou pertence a outro município", async () => {
      // Dado: nenhuma estação ativa encontrada para o município
      mockQuery.mockResolvedValueOnce({ rows: [] } as never);

      // Quando: usuário anônimo consulta últimas leituras de estação indisponível
      const response = await request(app).get(
        "/analise/publico/jacarei/estacoes/EST-INATIVA/ultimas-leituras",
      );

      // Então: retorna 404 Not Found
      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        statusCode: 404,
        message: "Estação não encontrada.",
      });
    });

    it("deve retornar 500 genérico sem expor err.message quando o banco falha nas últimas leituras públicas", async () => {
      // Dado: erro interno no PostgreSQL
      const consoleErrorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      mockQuery.mockRejectedValueOnce(new Error("relation medidas does not exist") as never);

      // Quando: usuário anônimo chama a rota pública de últimas leituras
      const response = await request(app).get(
        "/analise/publico/sjc/estacoes/EST-01/ultimas-leituras",
      );

      // Então: devolve 500 genérico sem vazar detalhes internos
      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        statusCode: 500,
        message: "Internal Server Error",
      });
      consoleErrorSpy.mockRestore();
    });
  });

  describe("GET /analise/publico/:municipio/iqar", () => {
    it("deve retornar 200 OK sem token quando existe estação ativa no município", async () => {
      // Dado: estação ativa cadastrada no município informado
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "e0000000-0000-4000-8000-000000000001",
            codigo: "EST-01",
            municipio: "São José dos Campos",
          },
        ],
      } as never);

      // Quando: usuário anônimo consulta o IQAr público do município
      const response = await request(app).get(
        "/analise/publico/S%C3%A3o%20Jos%C3%A9%20dos%20Campos/iqar",
      );

      // Então: retorna 200 OK com os dados de IQAr do município
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        indice: 45,
        classificacao: "Boa",
        cor: "#00E400",
        municipio: "São José dos Campos",
      });
    });

    it("deve retornar 404 Not Found quando estacaoId informado pertence a outro município ou está inativa", async () => {
      // Dado: estação informada na query não corresponde a estação ativa do município
      mockQuery.mockResolvedValueOnce({ rows: [] } as never);

      // Quando: consulta IQAr de Jacareí passando estacaoId de outro município
      const response = await request(app).get(
        "/analise/publico/jacarei/iqar?estacaoId=EST-DE-SJC",
      );

      // Então: valida estação + município + status ativo e retorna 404
      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        statusCode: 404,
        message: "Estação não encontrada.",
      });
    });

    it("deve retornar 500 genérico sem vazar detalhes quando o banco falha ao consultar IQAr público", async () => {
      // Dado: erro inesperado no pool do PostgreSQL
      const consoleErrorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      mockQuery.mockRejectedValueOnce(new Error("connection timeout") as never);

      // Quando: consulta o IQAr público
      const response = await request(app).get("/analise/publico/sjc/iqar");

      // Então: responde 500 sem expor mensagem interna
      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        statusCode: 500,
        message: "Internal Server Error",
      });
      consoleErrorSpy.mockRestore();
    });
  });

  describe("Prefixo redundante /public/analise/publico", () => {
    it("deve retornar 404 Not Found quando a rota pública é acessada com prefixo duplicado /public/analise/publico", async () => {
      // Dado: tentativa de acesso pelo caminho redundante antigo
      // Quando: faz GET em /public/analise/publico/sjc/iqar
      const response = await request(app).get("/public/analise/publico/sjc/iqar");

      // Então: rejeita com 404 evitando exposição de rota duplicada
      expect(response.status).toBe(404);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });
});
