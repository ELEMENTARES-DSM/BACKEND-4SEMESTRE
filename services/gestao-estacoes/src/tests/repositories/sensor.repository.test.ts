import { pool } from "../../config/db";
import * as sensorRepository from "../../repositories/sensor.repository";

jest.mock("../../config/db", () => ({
  pool: { query: jest.fn() },
}));

const query = jest.mocked(pool.query) as unknown as jest.Mock;

const dados = {
  codigo: "TEMP-K",
  nome: "Termômetro",
  tipo: "Temperatura",
  unidadeMedida: "°C",
  unidadeLeitura: "K" as string | null,
  fatorConversao: 1,
  offset: -273.15,
};

describe("sensor.repository (US-39)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    query.mockResolvedValue({ rows: [{ id: "s1" }] });
  });

  describe("create", () => {
    it("deve gravar unidade_leitura com placeholders, na ordem das colunas", async () => {
      // Quando
      await sensorRepository.create("estacao-1", dados);

      // Então
      const [sql, valores] = query.mock.calls[0];
      expect(sql).toContain("unidade_leitura");
      expect(sql).not.toContain("K");
      expect(valores).toEqual(["estacao-1", "Temperatura", "°C", "K", 1, -273.15, "TEMP-K", "Termômetro"]);
    });

    it("deve gravar NULL quando o sensor não tem unidade de leitura", async () => {
      // Quando
      await sensorRepository.create("estacao-1", { ...dados, unidadeLeitura: null });

      // Então
      expect(query.mock.calls[0][1][3]).toBeNull();
    });
  });

  describe("renomeio fator/ganho (colunas fator_conversao e offset_calibracao)", () => {
    const ALIAS = 'offset_calibracao AS "offset"';

    it("deve gravar nas colunas fator_conversao e offset_calibracao (e não nas antigas) ao criar", async () => {
      // Quando
      await sensorRepository.create("estacao-1", dados);

      // Então
      const [sql] = query.mock.calls[0];
      expect(sql).toContain("fator_conversao, offset_calibracao");
      expect(sql).not.toMatch(/\bganho\b/);
      expect(sql).not.toMatch(/\bfator\b/);
    });

    it.each([
      ["create", () => sensorRepository.create("estacao-1", dados)],
      ["update", () => sensorRepository.update("sensor-1", dados)],
      ["updateStatus", () => sensorRepository.updateStatus("sensor-1", "Inativo")],
      ["findById", () => sensorRepository.findById("sensor-1")],
      ["findByEstacaoId", () => sensorRepository.findByEstacaoId("estacao-1")],
      ["findByEstacaoIdETipo", () => sensorRepository.findByEstacaoIdETipo("estacao-1", "Temperatura")],
    ])(
      "deve devolver o offset com o alias entre aspas e sem SELECT * em %s",
      async (_nome, chamar) => {
        // Quando
        await chamar();

        // Então: sem o alias a resposta traria offset_calibracao em vez de offset
        const [sql] = query.mock.calls[0];
        expect(sql).toContain(ALIAS);
        expect(sql).toContain("fator_conversao");
        expect(sql).not.toContain("*");
      }
    );
  });

  describe("findParaSimulador", () => {
    it("deve juntar o catálogo, ler o offset com alias entre aspas e deixar de fora o sensor sem código", async () => {
      // Dado
      query.mockResolvedValue({ rows: [{ codigo: "CHUVA-01" }] });

      // Quando
      const sensores = await sensorRepository.findParaSimulador("estacao-1");

      // Então
      const [sql, valores] = query.mock.calls[0];
      expect(sql).toContain("JOIN tipos_sensor t ON t.nome = s.tipo");
      expect(sql).toContain("t.faixa_min, t.faixa_max");
      expect(sql).toContain('s.offset_calibracao AS "offset"');
      expect(sql).toContain("s.codigo IS NOT NULL");
      expect(sql).toContain("s.estacao_id = $1");
      expect(valores).toEqual(["estacao-1"]);
      expect(sensores).toEqual([{ codigo: "CHUVA-01" }]);
    });
  });

  describe("findDetectados (códigos recebidos sem sensor)", () => {
    it("deve ler o staging da estação, tirar os códigos que já têm sensor nela e usar só placeholders", async () => {
      // Dado
      query.mockResolvedValue({ rows: [] });

      // Quando
      await sensorRepository.findDetectados("estacao-1", 7, 50);

      // Então
      const [sql, valores] = query.mock.calls[0];
      expect(sql).toContain("FROM staging_telemetria st");
      expect(sql).toContain("st.estacao_uuid = $1");
      expect(sql).toContain("st.status <> 'rejeitada'");
      // Só os sensores DA estação, de qualquer status, e comparação exata do código.
      expect(sql).toContain("NOT EXISTS");
      expect(sql).toContain("s.estacao_id = $1 AND s.codigo = l.codigo");
      expect(sql).not.toMatch(/s\.status/);
      expect(sql).not.toMatch(/lower\(|upper\(|ilike/i);
      expect(sql).toContain("LIMIT $3");
      expect(valores).toEqual(["estacao-1", 7, 50]);
    });

    it("deve oferecer só código que dá para cadastrar (1 a 30 caracteres, sem espaço nas pontas)", async () => {
      // Dado
      query.mockResolvedValue({ rows: [] });

      // Quando
      await sensorRepository.findDetectados("estacao-1", 7, 50);

      // Então
      const sql: string = query.mock.calls[0][0];
      expect(sql).toContain("l.codigo = btrim(l.codigo)");
      expect(sql).toContain("char_length(l.codigo) BETWEEN 1 AND 30");
      // Número no lugar do código (42) não vira o código "42": o JSON precisa trazer texto.
      expect(sql).toContain("jsonb_typeof(e.item->'sensor') = 'string'");
    });

    it("deve devolver o código, o total, o último valor como número e o horário em ISO", async () => {
      // Dado
      query.mockResolvedValue({
        rows: [
          { codigo: "PM25", total: 12, ultimo_unixtime: "1763400000", ultimo_valor: "12.5000" },
          { codigo: "DIR-01", total: 1, ultimo_unixtime: "1763399000", ultimo_valor: null },
        ],
      });

      // Quando
      const detectados = await sensorRepository.findDetectados("estacao-1", 7, 50);

      // Então
      expect(detectados).toEqual([
        { codigo: "PM25", total: 12, ultimo_valor: 12.5, ultima_leitura_em: "2025-11-17T17:20:00.000Z" },
        { codigo: "DIR-01", total: 1, ultimo_valor: null, ultima_leitura_em: "2025-11-17T17:03:20.000Z" },
      ]);
    });

    it("deve devolver lista vazia quando a tabela do staging ainda não existe (42P01)", async () => {
      // Dado
      query.mockRejectedValue(Object.assign(new Error("relation does not exist"), { code: "42P01" }));

      // Quando / Então
      await expect(sensorRepository.findDetectados("estacao-1", 7, 50)).resolves.toEqual([]);
    });

    it("deve repassar qualquer outro erro do banco", async () => {
      // Dado
      const erro = Object.assign(new Error("conexão perdida"), { code: "08006" });
      query.mockRejectedValue(erro);

      // Quando / Então
      await expect(sensorRepository.findDetectados("estacao-1", 7, 50)).rejects.toBe(erro);
    });
  });

  describe("código único por estação", () => {
    const violacao = (constraint: string) =>
      Object.assign(new Error("duplicate key"), { code: "23505", constraint });

    it("deve responder 409 com a mensagem do código quando o banco acusa o índice do código ao criar", async () => {
      // Dado
      query.mockRejectedValue(violacao("uq_sensores_estacao_codigo"));

      // Quando
      const promessa = sensorRepository.create("estacao-1", dados);

      // Então
      await expect(promessa).rejects.toMatchObject({
        statusCode: 409,
        message: 'Já existe um sensor com o código "TEMP-K" nesta estação.',
      });
    });

    it("deve responder 409 com a mensagem do tipo quando o banco acusa um sensor por tipo ao criar", async () => {
      // Dado
      query.mockRejectedValue(violacao("uq_sensor_por_estacao"));

      // Quando
      const promessa = sensorRepository.create("estacao-1", dados);

      // Então
      await expect(promessa).rejects.toMatchObject({
        statusCode: 409,
        message: "Esta estação já possui um sensor de Temperatura cadastrado",
      });
    });

    it("deve traduzir a violação do índice do código também ao atualizar", async () => {
      // Dado
      query.mockRejectedValue(violacao("uq_sensores_estacao_codigo"));

      // Quando
      const promessa = sensorRepository.update("sensor-1", dados);

      // Então
      await expect(promessa).rejects.toMatchObject({ statusCode: 409 });
    });

    it("deve repassar o erro original quando a violação é de outra constraint", async () => {
      // Dado
      const erro = violacao("outra_constraint");
      query.mockRejectedValue(erro);

      // Quando
      const promessa = sensorRepository.create("estacao-1", dados);

      // Então
      await expect(promessa).rejects.toBe(erro);
    });

    it("deve buscar o código na estação com placeholders e ignorando o próprio sensor", async () => {
      // Dado
      query.mockResolvedValue({ rows: [] });

      // Quando
      const resultado = await sensorRepository.findByEstacaoIdECodigo("estacao-1", "TEMP-K", "sensor-1");

      // Então
      const [sql, valores] = query.mock.calls[0];
      expect(sql).toContain("estacao_id = $1 AND codigo = $2 AND id IS DISTINCT FROM $3");
      expect(valores).toEqual(["estacao-1", "TEMP-K", "sensor-1"]);
      expect(resultado).toBeNull();
    });

    it("deve gravar o código no UPDATE só quando o sensor ainda não tem um (COALESCE)", async () => {
      // Quando
      await sensorRepository.update("sensor-1", dados);

      // Então
      expect(query.mock.calls[0][0]).toContain("codigo = COALESCE(codigo, $6)");
    });
  });

  describe("update", () => {
    it("deve atualizar unidade_leitura junto com a grandeza, na ordem dos placeholders", async () => {
      // Quando
      await sensorRepository.update("sensor-1", dados);

      // Então
      const [sql, valores] = query.mock.calls[0];
      expect(sql).toContain("unidade_leitura = $3");
      expect(valores).toEqual(["Temperatura", "°C", "K", 1, -273.15, "TEMP-K", "sensor-1"]);
    });

    it("deve limpar a unidade de leitura quando o valor é null", async () => {
      // Quando
      await sensorRepository.update("sensor-1", { ...dados, unidadeLeitura: null });

      // Então
      expect(query.mock.calls[0][1][2]).toBeNull();
    });
  });
});
