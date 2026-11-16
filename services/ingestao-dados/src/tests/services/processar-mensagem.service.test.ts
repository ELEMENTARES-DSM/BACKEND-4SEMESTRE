import { MensagemBruta } from "../../dto/mensagem-ingestao.dto";
import {
  encerrarSemPublicar,
  gravarBruta,
  lerMensagem,
  listarRecebidas,
  marcarPendente,
  MensagemStaging,
} from "../../repositories/staging-valkey.repository";
import { inserirStaging } from "../../repositories/staging.repository";
import { buscarEstacaoParaValidacao } from "../../repositories/estacao.repository";
import { registrarRejeicao } from "../../services/registro-rejeicao.service";
import { registrarDuplicadaIgnorada } from "../../services/registro-duplicada.service";
import { gravacaoMetricsService } from "../../services/gravacao-metrics.service";
import {
  receberMensagem,
  verificarMensagem,
  verificarRecebidas,
} from "../../services/processar-mensagem.service";
import { solicitarProcessamentoPendentes } from "../../services/staging-publisher.service";
import { limparCadastrosConhecidos } from "../../services/validar-estacao.service";
import { pool } from "../../config/db";
import { logger } from "../../utils/logger";

// Unitário: Valkey, PostgreSQL, RabbitMQ (publicador) e os registros de log/métrica ficam mockados.
jest.mock("../../repositories/staging-valkey.repository");
jest.mock("../../repositories/staging.repository");
jest.mock("../../repositories/estacao.repository");
jest.mock("../../services/registro-rejeicao.service");
jest.mock("../../services/registro-duplicada.service");
jest.mock("../../services/staging-publisher.service");
jest.mock("../../config/db");

const AGORA = new Date("2026-11-16T10:00:00.000Z");

const ESTACAO_A = "00000000-0000-4000-8000-00000000000a";
const ESTACAO_B = "00000000-0000-4000-8000-00000000000b";
const topico = (estacao: string): string => `pulso/estacoes/${estacao}/telemetria`;
const payloadValido =
  '{ "timestamp": "2026-10-14T12:00:00Z", "leituras": [{"sensor":"temperatura","valor":25}] }';

function staging(dados: Partial<MensagemStaging> = {}): MensagemStaging {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    topico: topico(ESTACAO_A),
    payloadBruto: payloadValido,
    recebidoEm: "2026-10-14T12:00:05.000Z",
    status: "recebida",
    ...dados,
  };
}

const inserir = jest.mocked(inserirStaging);
const estacao = jest.mocked(buscarEstacaoParaValidacao);
const registrar = jest.mocked(registrarRejeicao);
const registrarDuplicada = jest.mocked(registrarDuplicadaIgnorada);

beforeEach(() => {
  jest.mocked(pool.connect).mockResolvedValue({
    query: jest.fn().mockResolvedValue({ rowCount: 1 }),
    release: jest.fn(),
    on: jest.fn(),
    removeListener: jest.fn(),
  } as never);
  inserir.mockResolvedValue(true);
  estacao.mockResolvedValue({ status: "Ativa", criado_em: new Date("2026-01-01T00:00:00Z") });
  jest.mocked(gravarBruta).mockResolvedValue("id-gerado");
  jest.mocked(listarRecebidas).mockResolvedValue([]);
  gravacaoMetricsService.reset();
  limparCadastrosConhecidos();
  jest.spyOn(logger, "warn").mockImplementation(() => undefined);
  jest.spyOn(logger, "error").mockImplementation(() => undefined);
});

describe("US-40 · Cenário 1 · gravação antes de tudo", () => {
  const bruta: MensagemBruta = {
    topico: topico(ESTACAO_A),
    payloadBruto: "  conteúdo {não é json} ",
    recebidoEm: "2026-10-14T12:00:05.000Z",
  };

  it("deve gravar no Valkey a mensagem exatamente como chegou quando ela é recebida do broker", async () => {
    // Dado (Arrange)
    // Quando (Act)
    await receberMensagem(bruta);

    // Então (Assert)
    expect(gravarBruta).toHaveBeenCalledWith(bruta);
  });

  it("deve verificar somente depois de gravar quando a mensagem é recebida", async () => {
    // Dado (Arrange)
    // Quando (Act)
    await receberMensagem(bruta);

    // Então (Assert)
    const gravou = jest.mocked(gravarBruta).mock.invocationCallOrder[0];
    const leuFila = jest.mocked(listarRecebidas).mock.invocationCallOrder[0];
    expect(gravou).toBeLessThan(leuFila);
  });

  it("deve rejeitar, para a mensagem não ser confirmada, quando o Valkey não grava", async () => {
    // Dado (Arrange)
    const erro = new Error("Valkey indisponível");
    jest.mocked(gravarBruta).mockRejectedValue(erro);

    // Quando (Act)
    const resultado = receberMensagem(bruta);

    // Então (Assert)
    await expect(resultado).rejects.toBe(erro);
    expect(listarRecebidas).not.toHaveBeenCalled();
  });
});

describe("US-40 · Cenário 2 · recusada fica no Valkey com o motivo e não segue", () => {
  it("deve marcar recusada com o motivo e não publicar quando a bateria é 150", async () => {
    // Dado (Arrange)
    const mensagem = staging({
      payloadBruto: '{"timestamp":"2026-10-14T12:00:00Z","nivel_bateria":150,"leituras":[{"sensor":"T","valor":1}]}',
    });

    // Quando (Act)
    const resultado = await verificarMensagem(mensagem);

    // Então (Assert)
    expect(resultado).toBe("recusada");
    expect(encerrarSemPublicar).toHaveBeenCalledWith(mensagem.id, "recusada", expect.any(Date), "Nível de bateria fora de 0 a 100");
    expect(marcarPendente).not.toHaveBeenCalled();
    expect(registrar).toHaveBeenCalledWith("Nível de bateria fora de 0 a 100", ESTACAO_A);
  });

  it("deve gravar na staging_telemetria o texto como chegou, sem JSON nem unixtime, quando o conteúdo não é JSON", async () => {
    // Dado (Arrange)
    const mensagem = staging({ payloadBruto: "  mensagem quebrada\n" });

    // Quando (Act)
    await verificarMensagem(mensagem);

    // Então (Assert)
    expect(inserir).toHaveBeenCalledWith(
      expect.objectContaining({
        id: mensagem.id,
        payloadBruto: "  mensagem quebrada\n",
        payloadJson: null,
        unixtime: null,
        status: "rejeitada",
        motivoRejeicao: "Payload malformado",
      }),
    );
    expect(encerrarSemPublicar).toHaveBeenCalledWith(mensagem.id, "recusada", expect.any(Date), "Payload malformado");
  });

  it("deve guardar o JSON e o unixtime quando a recusa é por leituras vazias", async () => {
    // Dado (Arrange)
    const bruto = '{"timestamp":"2026-10-14T12:00:00Z","leituras":[]}';

    // Quando (Act)
    await verificarMensagem(staging({ payloadBruto: bruto }));

    // Então (Assert)
    expect(inserir).toHaveBeenCalledWith(
      expect.objectContaining({
        payloadJson: bruto,
        unixtime: Date.parse("2026-10-14T12:00:00Z") / 1000,
        status: "rejeitada",
        motivoRejeicao: "Lista de leituras ausente ou vazia",
      }),
    );
  });

  it.each(["null", "[]", '{"timestamp":"inválido"}'])(
    "deve guardar o JSON sem unixtime quando o timestamp não é válido: %s",
    async (bruto) => {
      // Dado (Arrange)
      // Quando (Act)
      await verificarMensagem(staging({ payloadBruto: bruto }));

      // Então (Assert)
      expect(inserir).toHaveBeenCalledWith(
        expect.objectContaining({ payloadJson: bruto, unixtime: null, status: "rejeitada" }),
      );
    },
  );

  it("deve recusar com \"Estação desconhecida\" sem consultar o PostgreSQL quando o tópico não tem UUID", async () => {
    // Dado (Arrange)
    const mensagem = staging({ topico: "pulso/estacoes/est-001/telemetria" });

    // Quando (Act)
    const resultado = await verificarMensagem(mensagem);

    // Então (Assert)
    expect(resultado).toBe("recusada");
    expect(encerrarSemPublicar).toHaveBeenCalledWith(mensagem.id, "recusada", expect.any(Date), "Estação desconhecida");
    expect(estacao).not.toHaveBeenCalled();
    expect(inserir).not.toHaveBeenCalled();
  });

  it("deve somar em rejeitadasGravadas e não em mensagensGravadas quando a mensagem é recusada", async () => {
    // Dado (Arrange)
    estacao.mockResolvedValueOnce({ status: "Inativa", criado_em: new Date("2026-01-01T00:00:00Z") });

    // Quando (Act)
    await verificarMensagem(staging({ payloadBruto: "não é JSON" }));
    await verificarMensagem(staging());

    // Então (Assert)
    expect(gravacaoMetricsService.obterRejeitadasGravadas()).toBe(2);
    expect(gravacaoMetricsService.obterMensagensGravadas()).toBe(0);
  });
});

describe("US-12 · conferência da estação lida do Valkey", () => {
  it("deve recusar com \"Estação desconhecida\" quando o UUID não existe em estacoes", async () => {
    // Dado (Arrange)
    estacao.mockResolvedValue(null);

    // Quando (Act)
    const resultado = await verificarMensagem(staging());

    // Então (Assert)
    expect(resultado).toBe("recusada");
    expect(estacao).toHaveBeenCalledWith(ESTACAO_A);
    expect(inserir).toHaveBeenCalledWith(
      expect.objectContaining({ status: "rejeitada", motivoRejeicao: "Estação desconhecida", payloadJson: payloadValido }),
    );
    expect(registrar).toHaveBeenCalledWith("Estação desconhecida", ESTACAO_A);
  });

  it("deve recusar com \"Estação inativa\" quando o cadastro está Inativa", async () => {
    // Dado (Arrange)
    estacao.mockResolvedValue({ status: "Inativa", criado_em: new Date("2026-01-01T00:00:00Z") });

    // Quando (Act)
    await verificarMensagem(staging());

    // Então (Assert)
    expect(encerrarSemPublicar).toHaveBeenCalledWith(expect.any(String), "recusada", expect.any(Date), "Estação inativa");
    expect(registrar).toHaveBeenCalledWith("Estação inativa", ESTACAO_A);
  });

  it("deve aceitar quando a estação está \"Com Falha\", para ela poder voltar a Ativa", async () => {
    // Dado (Arrange)
    estacao.mockResolvedValue({ status: "Com Falha", criado_em: new Date("2026-01-01T00:00:00Z") });

    // Quando (Act)
    const resultado = await verificarMensagem(staging());

    // Então (Assert)
    expect(resultado).toBe("pendente");
    expect(registrar).not.toHaveBeenCalled();
  });

  it("deve conferir o payload antes da estação quando o payload é malformado", async () => {
    // Dado (Arrange)
    estacao.mockResolvedValue(null);

    // Quando (Act)
    await verificarMensagem(staging({ payloadBruto: "não é JSON" }));

    // Então (Assert)
    expect(estacao).not.toHaveBeenCalled();
    expect(registrar).toHaveBeenCalledWith("Payload malformado", ESTACAO_A);
  });
});

describe("US-28 · horário da leitura lido do Valkey", () => {
  it("deve recusar com \"Timestamp fora da faixa\" quando a leitura está 6 min à frente do recebimento", async () => {
    // Dado (Arrange)
    const mensagem = staging({ recebidoEm: "2026-10-14T11:54:00.000Z" });

    // Quando (Act)
    await verificarMensagem(mensagem);

    // Então (Assert)
    expect(encerrarSemPublicar).toHaveBeenCalledWith(mensagem.id, "recusada", expect.any(Date), "Timestamp fora da faixa");
  });
});

describe("US-40 · aceita entra em staging:pendentes", () => {
  it("deve marcar pendente e somar em mensagensGravadas quando a mensagem é aceita", async () => {
    // Dado (Arrange)
    const mensagem = staging();

    // Quando (Act)
    const resultado = await verificarMensagem(mensagem);

    // Então (Assert)
    expect(resultado).toBe("pendente");
    expect(marcarPendente).toHaveBeenCalledWith(mensagem.id);
    expect(gravacaoMetricsService.obterMensagensGravadas()).toBe(1);
    expect(registrar).not.toHaveBeenCalled();
    expect(registrarDuplicada).not.toHaveBeenCalled();
  });

  it("deve pedir a publicação depois de marcar pendente quando a mensagem é aceita", async () => {
    // Dado (Arrange)
    // Quando (Act)
    await verificarMensagem(staging());

    // Então (Assert)
    const marcou = jest.mocked(marcarPendente).mock.invocationCallOrder[0];
    const pediu = jest.mocked(solicitarProcessamentoPendentes).mock.invocationCallOrder[0];
    expect(marcou).toBeLessThan(pediu);
  });

  it("deve gravar a aceita na staging_telemetria com o id do Valkey e o conteúdo como chegou", async () => {
    // Dado (Arrange)
    const mensagem = staging();

    // Quando (Act)
    await verificarMensagem(mensagem);

    // Então (Assert)
    expect(inserir).toHaveBeenCalledWith(
      {
        id: mensagem.id,
        estacaoId: ESTACAO_A,
        recebidoEm: mensagem.recebidoEm,
        unixtime: Date.parse("2026-10-14T12:00:00Z") / 1000,
        payloadBruto: payloadValido,
        payloadJson: payloadValido,
        status: "recebida",
        motivoRejeicao: null,
      },
      expect.anything(),
    );
  });
});

describe("US-13 · duplicata pelo índice da staging_telemetria (até a 40.04)", () => {
  it("deve marcar duplicada, registrar 1 vez e não registrar rejeição quando o PostgreSQL não insere", async () => {
    // Dado (Arrange)
    inserir.mockResolvedValue(false);
    const mensagem = staging();

    // Quando (Act)
    const resultado = await verificarMensagem(mensagem);

    // Então (Assert)
    expect(resultado).toBe("duplicada");
    expect(encerrarSemPublicar).toHaveBeenCalledWith(mensagem.id, "duplicada", expect.any(Date));
    expect(marcarPendente).not.toHaveBeenCalled();
    expect(registrarDuplicada).toHaveBeenCalledTimes(1);
    expect(registrarDuplicada).toHaveBeenCalledWith({ estacaoId: ESTACAO_A, timestamp: "2026-10-14T12:00:00Z" });
    expect(registrar).not.toHaveBeenCalled();
    expect(gravacaoMetricsService.obterMensagensGravadas()).toBe(0);
  });

  it("deve não registrar duplicata quando a mensagem é recusada", async () => {
    // Dado (Arrange)
    // Quando (Act)
    await verificarMensagem(staging({ payloadBruto: "não é JSON" }));

    // Então (Assert)
    expect(registrarDuplicada).not.toHaveBeenCalled();
  });
});

describe("US-40 · Cenário 7 · expiração a partir do relógio", () => {
  it("deve passar o agora injetado para a expiração quando a mensagem é recusada", async () => {
    // Dado (Arrange)
    const mensagem = staging({ payloadBruto: "não é JSON" });

    // Quando (Act)
    await verificarMensagem(mensagem, () => AGORA);

    // Então (Assert)
    expect(encerrarSemPublicar).toHaveBeenCalledWith(mensagem.id, "recusada", AGORA, "Payload malformado");
  });

  it("deve passar o agora injetado para a expiração quando a mensagem é duplicada", async () => {
    // Dado (Arrange)
    inserir.mockResolvedValue(false);
    const mensagem = staging();

    // Quando (Act)
    await verificarMensagem(mensagem, () => AGORA);

    // Então (Assert)
    expect(encerrarSemPublicar).toHaveBeenCalledWith(mensagem.id, "duplicada", AGORA);
  });
});

describe("US-40 · Cenário 4 · PostgreSQL fora não trava o Valkey nem a publicação", () => {
  it("deve marcar pendente, pedir a publicação e registrar no log quando a staging_telemetria ou o último sinal falham", async () => {
    // Dado (Arrange)
    inserir.mockRejectedValue(new Error("Banco indisponível"));
    const mensagem = staging();

    // Quando (Act)
    const resultado = await verificarMensagem(mensagem);

    // Então (Assert)
    expect(resultado).toBe("pendente");
    expect(marcarPendente).toHaveBeenCalledWith(mensagem.id);
    expect(solicitarProcessamentoPendentes).toHaveBeenCalled();
    expect(registrarDuplicada).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      "PostgreSQL indisponível ao gravar a aceita e o último sinal; a leitura segue pelo Valkey",
      { stagingId: mensagem.id, erro: "Banco indisponível" },
    );
  });

  it("deve marcar recusada com o motivo e registrar no log quando a staging_telemetria falha ao gravar a recusa", async () => {
    // Dado (Arrange)
    inserir.mockRejectedValue(new Error("Banco indisponível"));
    const mensagem = staging({ payloadBruto: "não é JSON" });

    // Quando (Act)
    const resultado = await verificarMensagem(mensagem);

    // Então (Assert)
    expect(resultado).toBe("recusada");
    expect(encerrarSemPublicar).toHaveBeenCalledWith(mensagem.id, "recusada", expect.any(Date), "Payload malformado");
    expect(registrar).toHaveBeenCalledWith("Payload malformado", ESTACAO_A);
    expect(logger.error).toHaveBeenCalledWith(
      "PostgreSQL indisponível ao gravar a recusada; a leitura segue pelo Valkey",
      expect.objectContaining({ stagingId: mensagem.id }),
    );
  });

  it("deve aceitar com o cadastro guardado quando o banco cai depois de a estação ter sido vista", async () => {
    // Dado (Arrange)
    await verificarMensagem(staging({ id: "antes" }));
    estacao.mockRejectedValue(new Error("Banco indisponível"));
    inserir.mockRejectedValue(new Error("Banco indisponível"));

    // Quando (Act)
    const resultado = await verificarMensagem(staging({ id: "durante" }));

    // Então (Assert)
    expect(resultado).toBe("pendente");
    expect(marcarPendente).toHaveBeenCalledWith("durante");
  });

  it("deve lançar, como erro temporário, sem gravar nem registrar rejeição quando o banco falha e a estação nunca foi vista", async () => {
    // Dado (Arrange)
    const erro = new Error("Banco indisponível");
    estacao.mockRejectedValue(erro);

    // Quando (Act)
    const resultado = verificarMensagem(staging());

    // Então (Assert)
    await expect(resultado).rejects.toBe(erro);
    expect(inserir).not.toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
    expect(encerrarSemPublicar).not.toHaveBeenCalled();
    expect(marcarPendente).not.toHaveBeenCalled();
  });
});

describe("US-40 · fila de verificação: uma mensagem não trava as outras", () => {
  function fila(...mensagens: MensagemStaging[]): void {
    jest.mocked(listarRecebidas).mockResolvedValue(mensagens.map((m) => m.id));
    jest.mocked(lerMensagem).mockImplementation(async (id) => mensagens.find((m) => m.id === id) ?? null);
  }

  it("deve manter recebida e seguir para as outras estações quando o PostgreSQL falha para uma estação nunca vista", async () => {
    // Dado (Arrange)
    const a1 = staging({ id: "a1", topico: topico(ESTACAO_A) });
    const b1 = staging({ id: "b1", topico: topico(ESTACAO_B) });
    fila(a1, b1);
    estacao.mockImplementation(async (id) => {
      if (id === ESTACAO_A) throw new Error("Banco indisponível");
      return { status: "Ativa", criado_em: new Date("2026-01-01T00:00:00Z") };
    });

    // Quando (Act)
    await verificarRecebidas();

    // Então (Assert)
    expect(marcarPendente).toHaveBeenCalledTimes(1);
    expect(marcarPendente).toHaveBeenCalledWith("b1");
    expect(encerrarSemPublicar).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "Verificação adiada para a próxima rodada",
      expect.objectContaining({ stagingId: "a1" }),
    );
  });

  it("deve adiar as mensagens seguintes da mesma estação quando uma dela fica adiada", async () => {
    // Dado (Arrange)
    const a1 = staging({ id: "a1", topico: topico(ESTACAO_A) });
    const a2 = staging({ id: "a2", topico: topico(ESTACAO_A) });
    const b1 = staging({ id: "b1", topico: topico(ESTACAO_B) });
    fila(a1, a2, b1);
    estacao
      .mockRejectedValueOnce(new Error("Banco indisponível"))
      .mockResolvedValue({ status: "Ativa", criado_em: new Date("2026-01-01T00:00:00Z") });

    // Quando (Act)
    await verificarRecebidas();

    // Então (Assert)
    expect(jest.mocked(marcarPendente).mock.calls).toEqual([["b1"]]);
  });

  it("deve verificar a mensagem adiada na rodada seguinte quando o PostgreSQL volta", async () => {
    // Dado (Arrange)
    const a1 = staging({ id: "a1" });
    fila(a1);
    estacao
      .mockRejectedValueOnce(new Error("Banco indisponível"))
      .mockResolvedValue({ status: "Ativa", criado_em: new Date("2026-01-01T00:00:00Z") });
    await verificarRecebidas();

    // Quando (Act)
    await verificarRecebidas();

    // Então (Assert)
    expect(marcarPendente).toHaveBeenCalledWith("a1");
  });

  it("deve registrar no log e não lançar quando o Valkey falha ao ler a fila", async () => {
    // Dado (Arrange)
    jest.mocked(listarRecebidas).mockRejectedValue(new Error("Valkey indisponível"));

    // Quando (Act)
    const resultado = verificarRecebidas();

    // Então (Assert)
    await expect(resultado).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      "Falha ao ler a fila de verificação no Valkey",
      { erro: "Valkey indisponível" },
    );
  });

  it("deve fazer outra rodada quando um pedido chega durante a rodada atual", async () => {
    // Dado (Arrange)
    let liberar!: (ids: string[]) => void;
    jest.mocked(listarRecebidas)
      .mockImplementationOnce(() => new Promise((resolve) => { liberar = resolve; }))
      .mockResolvedValue([]);
    const primeira = verificarRecebidas();

    // Quando (Act)
    await verificarRecebidas();
    liberar([]);
    await primeira;

    // Então (Assert)
    expect(listarRecebidas).toHaveBeenCalledTimes(2);
  });
});
