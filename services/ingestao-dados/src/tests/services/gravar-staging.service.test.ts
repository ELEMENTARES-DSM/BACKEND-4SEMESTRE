import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { PoolClient } from "pg";
import { pool } from "../../config/db";
import { gravarAceita } from "../../services/gravar-staging.service";
import * as stagingRepository from "../../repositories/staging.repository";
import * as estacaoRepository from "../../repositories/estacao.repository";

jest.mock("../../config/db");
jest.mock("../../repositories/staging.repository");
jest.mock("../../repositories/estacao.repository");

describe("gravar-staging.service - Task 14.02", () => {
  let mockClient: jest.Mocked<PoolClient>;

  beforeEach(() => {
    jest.clearAllMocks();

    const mockQuery = jest.fn() as unknown as jest.MockedFunction<
      PoolClient["query"]
    >;
    mockQuery.mockResolvedValue({
      command: "SELECT",
      rowCount: 1,
      oid: 0,
      fields: [],
      rows: [],
    });

    mockClient = {
      query: mockQuery,
      release: jest.fn(),
    } as unknown as jest.Mocked<PoolClient>;

    jest.mocked(pool.connect).mockResolvedValue(mockClient);
  });

  const mensagemBase = {
    estacaoId: "e30a57e3-0d33-4f9e-86b2-6cb1690a7891",
    topico: "estacoes/telemetria",
    recebidoEm: "2026-10-16T10:00:00.000Z",
  };

  it("Cenário 1 e 2: deve gravar mensagem aceita e atualizar ultimo_ping e nivel_bateria na mesma transação", async () => {
    const mensagem = {
      ...mensagemBase,
      payloadBruto: JSON.stringify({
        timestamp: "2026-10-16T09:55:00Z",
        nivel_bateria: 87,
        leituras: [{ sensor: "TMP", valor: 25.0 }],
      }),
    };

    jest.mocked(stagingRepository.inserirStaging).mockResolvedValue(true);
    jest
      .mocked(estacaoRepository.atualizarSinalEstacao)
      .mockResolvedValue(true);

    const resultado = await gravarAceita(mensagem);

    expect(resultado).toBe("recebida");
    expect(mockClient.query).toHaveBeenCalledWith("BEGIN");
    expect(mockClient.query).toHaveBeenCalledWith("COMMIT");
    expect(mockClient.release).toHaveBeenCalled();

    expect(estacaoRepository.atualizarSinalEstacao).toHaveBeenCalledWith(
      mockClient,
      {
        estacaoId: mensagem.estacaoId,
        ultimoPing: mensagem.recebidoEm,
        nivelBateria: 87,
      },
    );
  });

  it("Cenário 3: deve atualizar ultimo_ping mantendo a bateria quando nivel_bateria for ausente", async () => {
    const mensagem = {
      ...mensagemBase,
      payloadBruto: JSON.stringify({
        timestamp: "2026-10-16T09:55:00Z",
        leituras: [{ sensor: "TMP", valor: 25.0 }],
      }),
    };

    jest.mocked(stagingRepository.inserirStaging).mockResolvedValue(true);

    const resultado = await gravarAceita(mensagem);

    expect(resultado).toBe("recebida");
    expect(estacaoRepository.atualizarSinalEstacao).toHaveBeenCalledWith(
      mockClient,
      {
        estacaoId: mensagem.estacaoId,
        ultimoPing: mensagem.recebidoEm,
        nivelBateria: undefined,
      },
    );
  });

  it("Cenário 5: não deve atualizar a estação se a mensagem for duplicata", async () => {
    const mensagem = {
      ...mensagemBase,
      payloadBruto: JSON.stringify({
        timestamp: "2026-10-16T09:55:00Z",
        leituras: [{ sensor: "TMP", valor: 25.0 }],
      }),
    };

    jest.mocked(stagingRepository.inserirStaging).mockResolvedValue(false);

    const resultado = await gravarAceita(mensagem);

    expect(resultado).toBe("duplicata");
    expect(mockClient.query).toHaveBeenCalledWith("COMMIT");
    expect(estacaoRepository.atualizarSinalEstacao).not.toHaveBeenCalled();
  });

  it("Cenário 7 / Atomicidade: deve dar ROLLBACK se falhar a gravação/atualização na estação", async () => {
    const mensagem = {
      ...mensagemBase,
      payloadBruto: JSON.stringify({
        timestamp: "2026-10-16T09:55:00Z",
        leituras: [{ sensor: "TMP", valor: 25.0 }],
      }),
    };

    jest.mocked(stagingRepository.inserirStaging).mockResolvedValue(true);
    jest
      .mocked(estacaoRepository.atualizarSinalEstacao)
      .mockRejectedValue(new Error("Erro ao acessar banco de dados"));

    await expect(gravarAceita(mensagem)).rejects.toThrow(
      "Erro ao acessar banco de dados",
    );

    expect(mockClient.query).toHaveBeenCalledWith("ROLLBACK");
    expect(mockClient.release).toHaveBeenCalled();
  });
});
