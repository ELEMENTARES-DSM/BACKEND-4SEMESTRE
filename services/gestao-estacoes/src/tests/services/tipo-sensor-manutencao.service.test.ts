import * as tipoSensorRepository from "../../repositories/tipo-sensor.repository";
import { atualizar, excluir } from "../../services/tipo-sensor.service";
import { TipoSensorCatalogo } from "../../models/tipo-sensor.model";

jest.mock("../../repositories/tipo-sensor.repository", () => ({
  findAll: jest.fn(),
  findByNome: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
  contarSensoresDaGrandeza: jest.fn(),
}));

const repo = jest.mocked(tipoSensorRepository);
const ID = "5549e54b-346e-4a87-8f7d-d2604c878530";

const temperatura: TipoSensorCatalogo = {
  id: ID,
  nome: "Temperatura",
  unidade: "°C",
  faixa_min: "-50.00",
  faixa_max: "60.00",
  agregacao: "media",
};

describe("tipo-sensor.service: atualizar e excluir (US-39)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repo.findById.mockResolvedValue(temperatura);
    repo.contarSensoresDaGrandeza.mockResolvedValue(0);
    repo.update.mockImplementation(async (_id, campos) => ({ ...temperatura, ...campos } as never));
    repo.remove.mockResolvedValue(true);
  });

  describe("atualizar", () => {
    it("deve responder 404 quando a grandeza não existe", async () => {
      // Dado
      repo.findById.mockResolvedValue(null);

      // Quando
      const promessa = atualizar(ID, { faixa_max: 70 });

      // Então
      await expect(promessa).rejects.toMatchObject({ statusCode: 404 });
      expect(repo.update).not.toHaveBeenCalled();
    });

    it("deve alterar faixa e agregação sem exigir que a grandeza esteja livre de sensores", async () => {
      // Quando
      const resultado = await atualizar(ID, { faixa_max: 70, agregacao: "soma" });

      // Então: apenasSemSensores = false, então vale mesmo com sensores usando a grandeza
      expect(repo.update).toHaveBeenCalledWith(
        ID,
        { unidade: undefined, faixa_max: 70, agregacao: "soma" },
        false
      );
      expect(resultado).toMatchObject({ faixa_max: 70, agregacao: "soma" });
    });

    it("deve aceitar faixa_min logo abaixo da faixa_max gravada e responder 400 quando é igual", async () => {
      // Quando / Então: borda dos dois lados (faixa_max gravada é 60)
      await expect(atualizar(ID, { faixa_min: 59.99 })).resolves.toBeDefined();
      await expect(atualizar(ID, { faixa_min: 60 })).rejects.toMatchObject({
        statusCode: 400,
        message: "faixa_min deve ser menor que faixa_max.",
      });
    });

    it("deve responder 400 quando faixa_max informada é menor ou igual à faixa_min gravada", async () => {
      // Quando / Então: faixa_min gravada é -50
      await expect(atualizar(ID, { faixa_max: -50 })).rejects.toMatchObject({ statusCode: 400 });
      await expect(atualizar(ID, { faixa_max: -49.99 })).resolves.toBeDefined();
    });

    it("deve comparar os dois lados informados juntos, sem olhar o valor gravado", async () => {
      // Quando / Então
      await expect(atualizar(ID, { faixa_min: 100, faixa_max: 200 })).resolves.toBeDefined();
      await expect(atualizar(ID, { faixa_min: 200, faixa_max: 100 })).rejects.toMatchObject({
        statusCode: 400,
      });
    });

    it("deve trocar a unidade exigindo, na mesma instrução, que nenhum sensor use a grandeza", async () => {
      // Quando
      await atualizar(ID, { unidade: "K" });

      // Então
      expect(repo.update).toHaveBeenCalledWith(ID, { unidade: "K" }, true);
    });

    it("deve responder 409 com a contagem de sensores quando a unidade não pode mudar", async () => {
      // Dado: nenhuma linha afetada, a grandeza ainda existe e 2 sensores a usam
      repo.update.mockResolvedValue(null);
      repo.contarSensoresDaGrandeza.mockResolvedValue(2);

      // Quando
      const promessa = atualizar(ID, { unidade: "K" });

      // Então
      await expect(promessa).rejects.toMatchObject({ statusCode: 409 });
      await expect(promessa).rejects.toThrow(/usada por 2 sensores/);
      await expect(promessa).rejects.toThrow(/Faixa e agregação podem ser alteradas/);
    });

    it("deve usar o singular quando só 1 sensor usa a grandeza", async () => {
      // Dado
      repo.update.mockResolvedValue(null);
      repo.contarSensoresDaGrandeza.mockResolvedValue(1);

      // Quando / Então
      await expect(atualizar(ID, { unidade: "K" })).rejects.toThrow(/usada por 1 sensor\./);
    });

    it("deve responder 404 quando a grandeza some entre a leitura e a troca", async () => {
      // Dado: existe na primeira leitura e não existe depois da troca recusada
      repo.findById.mockResolvedValueOnce(temperatura).mockResolvedValueOnce(null);
      repo.update.mockResolvedValue(null);

      // Quando
      const promessa = atualizar(ID, { unidade: "K" });

      // Então
      await expect(promessa).rejects.toMatchObject({ statusCode: 404 });
    });

    it("deve tratar a mesma unidade como sem mudança, sem exigir grandeza livre", async () => {
      // Quando: repete a unidade e muda a faixa
      await atualizar(ID, { unidade: "°C", faixa_max: 70 });

      // Então
      expect(repo.update).toHaveBeenCalledWith(ID, { unidade: undefined, faixa_max: 70 }, false);
    });

    it("deve devolver a grandeza sem gravar quando só repete a unidade atual", async () => {
      // Quando
      const resultado = await atualizar(ID, { unidade: "°C" });

      // Então
      expect(resultado).toBe(temperatura);
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe("excluir", () => {
    it("deve responder 404 quando a grandeza não existe", async () => {
      // Dado
      repo.findById.mockResolvedValue(null);

      // Quando
      const promessa = excluir(ID);

      // Então
      await expect(promessa).rejects.toMatchObject({ statusCode: 404 });
      expect(repo.remove).not.toHaveBeenCalled();
    });

    it("deve apagar quando nenhum sensor usa a grandeza", async () => {
      // Quando
      await excluir(ID);

      // Então
      expect(repo.contarSensoresDaGrandeza).toHaveBeenCalledWith("Temperatura");
      expect(repo.remove).toHaveBeenCalledWith(ID);
    });

    it("deve responder 409 com a mensagem clara e não apagar quando há sensores", async () => {
      // Dado
      repo.contarSensoresDaGrandeza.mockResolvedValue(3);

      // Quando
      const promessa = excluir(ID);

      // Então
      await expect(promessa).rejects.toMatchObject({
        statusCode: 409,
        message:
          "Esta grandeza é usada por 3 sensores e não pode ser excluída. " +
          "Sensores com medidas não podem ser removidos; para parar de usá-la, inative os sensores.",
      });
      expect(repo.remove).not.toHaveBeenCalled();
    });

    it("deve responder 409 quando o banco recusa o DELETE por chave estrangeira (23503)", async () => {
      // Dado: um sensor passou a usar a grandeza depois da contagem
      repo.contarSensoresDaGrandeza.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
      repo.remove.mockRejectedValue(Object.assign(new Error("fk"), { code: "23503" }));

      // Quando
      const promessa = excluir(ID);

      // Então
      await expect(promessa).rejects.toMatchObject({ statusCode: 409 });
      await expect(promessa).rejects.toThrow(/usada por 1 sensor e não pode ser excluída/);
    });

    it("deve repassar o erro original quando a falha do banco não é de chave estrangeira", async () => {
      // Dado
      const erro = Object.assign(new Error("conexão perdida"), { code: "08006" });
      repo.remove.mockRejectedValue(erro);

      // Quando / Então
      await expect(excluir(ID)).rejects.toBe(erro);
    });

    it("deve responder 404 quando a grandeza some entre a leitura e o DELETE", async () => {
      // Dado
      repo.remove.mockResolvedValue(false);

      // Quando / Então
      await expect(excluir(ID)).rejects.toMatchObject({ statusCode: 404 });
    });
  });
});
