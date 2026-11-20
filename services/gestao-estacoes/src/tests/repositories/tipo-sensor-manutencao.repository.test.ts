import { pool } from "../../config/db";
import * as tipoSensorRepository from "../../repositories/tipo-sensor.repository";

jest.mock("../../config/db", () => ({
  pool: { query: jest.fn() },
}));

const query = jest.mocked(pool.query) as unknown as jest.Mock;
const ID = "5549e54b-346e-4a87-8f7d-d2604c878530";

describe("tipo-sensor.repository: PUT e DELETE (US-39)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    query.mockResolvedValue({ rows: [{ id: ID }], rowCount: 1 });
  });

  describe("update", () => {
    it("deve montar o SET só com os campos informados, em placeholders, e filtrar pelo id", async () => {
      // Quando
      await tipoSensorRepository.update(ID, { faixa_max: 70, agregacao: "soma" }, false);

      // Então
      const [sql, valores] = query.mock.calls[0];
      expect(sql).toContain("SET faixa_max = $2, agregacao = $3");
      expect(sql).toContain("WHERE id = $1");
      expect(sql).not.toContain("NOT EXISTS");
      expect(sql).not.toContain("70");
      expect(valores).toEqual([ID, 70, "soma"]);
    });

    it("deve trocar a unidade e conferir 'nenhum sensor usa' na MESMA instrução quando apenasSemSensores é true", async () => {
      // Quando
      await tipoSensorRepository.update(ID, { unidade: "K" }, true);

      // Então: uma única consulta, sem janela entre conferir e gravar
      expect(query).toHaveBeenCalledTimes(1);
      const [sql, valores] = query.mock.calls[0];
      expect(sql).toContain("SET unidade = $2");
      expect(sql).toContain("NOT EXISTS (SELECT 1 FROM sensores WHERE sensores.tipo = tipos_sensor.nome)");
      expect(valores).toEqual([ID, "K"]);
    });

    it("deve devolver null quando nenhuma linha foi afetada", async () => {
      // Dado
      query.mockResolvedValue({ rows: [], rowCount: 0 });

      // Quando
      const resultado = await tipoSensorRepository.update(ID, { unidade: "K" }, true);

      // Então
      expect(resultado).toBeNull();
    });

    it("deve responder 400 quando o CHECK da faixa recusa a gravação (23514)", async () => {
      // Dado: duas alterações juntas, cada uma mudando um lado da faixa
      query.mockRejectedValue(Object.assign(new Error("check"), { code: "23514" }));

      // Quando
      const promessa = tipoSensorRepository.update(ID, { faixa_min: 10 }, false);

      // Então
      await expect(promessa).rejects.toMatchObject({
        statusCode: 400,
        message: "faixa_min deve ser menor que faixa_max.",
      });
    });

    it("deve repassar o erro original quando não é violação do CHECK", async () => {
      // Dado
      const erro = Object.assign(new Error("conexão perdida"), { code: "08006" });
      query.mockRejectedValue(erro);

      // Quando / Então
      await expect(tipoSensorRepository.update(ID, { faixa_min: 10 }, false)).rejects.toBe(erro);
    });
  });

  describe("remove, contarSensoresDaGrandeza e findById", () => {
    it("deve apagar pelo id com placeholder e informar se alguma linha saiu", async () => {
      // Quando
      const apagou = await tipoSensorRepository.remove(ID);

      // Então
      expect(apagou).toBe(true);
      expect(query.mock.calls[0][1]).toEqual([ID]);

      query.mockResolvedValue({ rows: [], rowCount: 0 });
      expect(await tipoSensorRepository.remove(ID)).toBe(false);
    });

    it("deve repassar a violação de chave estrangeira do DELETE para o service decidir", async () => {
      // Dado
      const erro = Object.assign(new Error("fk"), { code: "23503" });
      query.mockRejectedValue(erro);

      // Quando / Então
      await expect(tipoSensorRepository.remove(ID)).rejects.toBe(erro);
    });

    it("deve contar os sensores da grandeza pelo nome, com placeholder", async () => {
      // Dado
      query.mockResolvedValue({ rows: [{ total: 4 }] });

      // Quando
      const total = await tipoSensorRepository.contarSensoresDaGrandeza("Temperatura");

      // Então
      expect(total).toBe(4);
      expect(query.mock.calls[0][1]).toEqual(["Temperatura"]);
    });

    it("deve devolver null quando o id não existe", async () => {
      // Dado
      query.mockResolvedValue({ rows: [] });

      // Quando / Então
      expect(await tipoSensorRepository.findById(ID)).toBeNull();
    });
  });
});
