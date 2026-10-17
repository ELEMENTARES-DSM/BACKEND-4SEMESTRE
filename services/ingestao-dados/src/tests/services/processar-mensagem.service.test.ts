import { MensagemIngestaoInput } from "../../dto/mensagem-ingestao.dto";
import { inserirStaging } from "../../repositories/staging.repository";
import { registrarRejeicao } from "../../services/registro-rejeicao.service";
import { registrarDuplicadaIgnorada } from "../../services/registro-duplicada.service";
import { processarMensagem } from "../../services/processar-mensagem.service";
import { pool } from "../../config/db";

jest.mock("../../repositories/staging.repository");
jest.mock("../../services/registro-rejeicao.service");
jest.mock("../../services/registro-duplicada.service");
jest.mock("../../config/db");

beforeEach(() => {
  const mockClient = {
    query: jest.fn().mockResolvedValue({ rowCount: 1 }),
    release: jest.fn(),
  };
  jest.mocked(pool.connect).mockResolvedValue(mockClient as never);
});

const inserir = jest.mocked(inserirStaging);
const registrar = jest.mocked(registrarRejeicao);
const payloadBruto =
  '{ "timestamp": "2026-10-14T12:00:00Z", "leituras": [{"sensor":"temperatura","valor":25}] }';
const mensagem: MensagemIngestaoInput = {
  estacaoId: "00000000-0000-4000-8000-000000000001",
  topico: "estacoes/leitura",
  payloadBruto,
  recebidoEm: "2026-10-14T12:00:05Z",
};

describe("processarMensagem", () => {
  beforeEach(() => {
    inserir.mockReset();
    inserir.mockResolvedValue(true);
  });

  it("grava aceita preservando conteúdo e horário de recebimento", async () => {
    await expect(processarMensagem(mensagem)).resolves.toBe("recebida");
    expect(inserir).toHaveBeenCalledTimes(1);
    expect(inserir).toHaveBeenCalledWith(
      {
        estacaoId: mensagem.estacaoId,
        recebidoEm: mensagem.recebidoEm,
        unixtime: Date.parse("2026-10-14T12:00:00Z") / 1000,
        payloadBruto,
        payloadJson: payloadBruto,
        status: "recebida",
        motivoRejeicao: null,
      },
      expect.anything(),
    );
    expect(registrar).not.toHaveBeenCalled();
  });

  it("retorna duplicata quando o repository não insere", async () => {
    inserir.mockResolvedValue(false);
    await expect(processarMensagem(mensagem)).resolves.toBe("duplicata");
    expect(inserir).toHaveBeenCalledTimes(1);
    expect(registrar).not.toHaveBeenCalled();
  });

  it("preserva texto rejeitado que não é JSON", async () => {
    const bruto = "  mensagem quebrada\n";
    await expect(
      processarMensagem({ ...mensagem, payloadBruto: bruto }),
    ).resolves.toBe("rejeitada");
    expect(inserir).toHaveBeenCalledWith(
      expect.objectContaining({
        payloadBruto: bruto,
        payloadJson: null,
        unixtime: null,
        status: "rejeitada",
        motivoRejeicao: "Payload malformado",
      }),
    );
    expect(registrar).toHaveBeenCalledWith(
      "Payload malformado",
      mensagem.estacaoId,
    );
  });

  it("guarda JSON e timestamp de payload rejeitado por leituras vazias", async () => {
    const bruto = '{"timestamp":"2026-10-14T12:00:00Z","leituras":[]}';
    await processarMensagem({ ...mensagem, payloadBruto: bruto });
    expect(inserir).toHaveBeenCalledWith(
      expect.objectContaining({
        payloadBruto: bruto,
        payloadJson: bruto,
        unixtime: Date.parse("2026-10-14T12:00:00Z") / 1000,
        status: "rejeitada",
        motivoRejeicao: "Lista de leituras ausente ou vazia",
      }),
    );
  });

  it.each(["null", "[]", '{"timestamp":"inválido"}'])(
    "guarda JSON rejeitado sem timestamp válido: %s",
    async (bruto) => {
      await processarMensagem({ ...mensagem, payloadBruto: bruto });
      expect(inserir).toHaveBeenCalledWith(
        expect.objectContaining({
          payloadJson: bruto,
          unixtime: null,
          status: "rejeitada",
        }),
      );
    },
  );

  it.each([payloadBruto, "não é JSON"])(
    "propaga falha de persistência sem registrar rejeição: %s",
    async (bruto) => {
      const erro = new Error("Banco indisponível");
      inserir.mockRejectedValue(erro);
      await expect(
        processarMensagem({ ...mensagem, payloadBruto: bruto }),
      ).rejects.toBe(erro);
      expect(registrar).not.toHaveBeenCalled();
    },
  );
});

describe("processarMensagem - registro de duplicatas (TASK 13.02)", () => {
  const registrarDuplicada = jest.mocked(registrarDuplicadaIgnorada);

  beforeEach(() => {
    inserir.mockReset();
    inserir.mockResolvedValue(true);
  });

  it("registra a duplicata 1 vez com estacaoId e timestamp e não registra rejeição", async () => {
    inserir.mockResolvedValue(false);

    await expect(processarMensagem(mensagem)).resolves.toBe("duplicata");

    expect(registrarDuplicada).toHaveBeenCalledTimes(1);
    expect(registrarDuplicada).toHaveBeenCalledWith({
      estacaoId: mensagem.estacaoId,
      timestamp: "2026-10-14T12:00:00Z",
    });
    expect(registrar).not.toHaveBeenCalled();
  });

  it("não registra duplicata quando a mensagem é recebida", async () => {
    await expect(processarMensagem(mensagem)).resolves.toBe("recebida");
    expect(registrarDuplicada).not.toHaveBeenCalled();
  });

  it("não registra duplicata quando o payload é rejeitado", async () => {
    await expect(
      processarMensagem({ ...mensagem, payloadBruto: "não é JSON" }),
    ).resolves.toBe("rejeitada");
    expect(registrarDuplicada).not.toHaveBeenCalled();
  });

  it("não registra duplicata para rejeição de negócio da US-12", async () => {
    await expect(processarMensagem(mensagem, "Estação inativa")).resolves.toBe(
      "rejeitada",
    );
    expect(registrarDuplicada).not.toHaveBeenCalled();
  });

  it("não registra duplicata quando a gravação falha", async () => {
    const erro = new Error("Banco indisponível");
    inserir.mockRejectedValue(erro);

    await expect(processarMensagem(mensagem)).rejects.toBe(erro);
    expect(registrarDuplicada).not.toHaveBeenCalled();
  });
});
