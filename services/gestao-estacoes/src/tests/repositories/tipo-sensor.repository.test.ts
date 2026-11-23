import { pool } from "../../config/db";
import * as tipoSensorRepository from "../../repositories/tipo-sensor.repository";
import { CreateTipoSensorDTO } from "../../dto/create-tipo-sensor.dto";

jest.mock("../../config/db", () => ({
  pool: { query: jest.fn() },
}));

const query = jest.mocked(pool.query) as unknown as jest.Mock;

const dados: CreateTipoSensorDTO = {
  nome: "Nebulosidade",
  unidade: "%",
  faixa_min: 0,
  faixa_max: 100,
  agregacao: "media",
};

describe("tipo-sensor.repository (US-39)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("create", () => {
    it("deve gravar com placeholders e devolver a linha criada", async () => {
      // Dado
      const linha = { id: "1", ...dados, faixa_min: "0.00", faixa_max: "100.00" };
      query.mockResolvedValue({ rows: [linha] });

      // Quando
      const resultado = await tipoSensorRepository.create(dados);

      // Então
      const [sql, valores] = query.mock.calls[0];
      expect(sql).toContain("$1");
      expect(sql).not.toContain(dados.nome);
      expect(valores).toEqual(["Nebulosidade", "%", 0, 100, "media"]);
      expect(resultado).toEqual(linha);
    });

    it("deve responder 409 com a mensagem da grandeza quando o banco acusa nome repetido (23505)", async () => {
      // Dado
      query.mockRejectedValue(Object.assign(new Error("duplicate key"), { code: "23505" }));

      // Quando
      const promessa = tipoSensorRepository.create(dados);

      // Então
      await expect(promessa).rejects.toMatchObject({
        statusCode: 409,
        message: 'Já existe uma grandeza com o nome "Nebulosidade" no catálogo.',
      });
    });

    it("deve repassar o erro original quando não é nome repetido", async () => {
      // Dado
      const erro = Object.assign(new Error("conexão perdida"), { code: "08006" });
      query.mockRejectedValue(erro);

      // Quando
      const promessa = tipoSensorRepository.create(dados);

      // Então
      await expect(promessa).rejects.toBe(erro);
    });
  });

  describe("findByNome", () => {
    it("deve devolver null quando a grandeza não existe", async () => {
      // Dado
      query.mockResolvedValue({ rows: [] });

      // Quando
      const resultado = await tipoSensorRepository.findByNome("Inexistente");

      // Então
      expect(resultado).toBeNull();
      expect(query.mock.calls[0][1]).toEqual(["Inexistente"]);
    });
  });
});
