import { MensagemBruta } from "../../dto/mensagem-ingestao.dto";
import {
  encerrarSemPublicar,
  gravarBruta,
  lerMensagem,
  listarRecebidas,
  marcarPendente,
  MensagemStaging,
} from "../../repositories/staging-valkey.repository";
import { gravarAceita, gravarRejeitada } from "../../services/gravar-staging.service";
import { conferirEstacao } from "../../services/validar-estacao.service";
import { registrarRejeicao } from "../../services/registro-rejeicao.service";
import { registrarDuplicadaIgnorada } from "../../services/registro-duplicada.service";
import { gravacaoMetricsService } from "../../services/gravacao-metrics.service";
import { solicitarProcessamentoPendentes } from "../../services/staging-publisher.service";
import {
  encerrarVerificacao,
  iniciarVerificacao,
  receberMensagem,
  verificarMensagem,
  verificarRecebidas,
} from "../../services/processar-mensagem.service";
import { logger } from "../../utils/logger";

// Unitário: Valkey (repository), PostgreSQL (gravar-staging e conferirEstacao,
// que têm banco e cache), RabbitMQ (publicador), log e relógio mockados. A
// validação do payload e a leitura do tópico são puras e entram reais; os
// contadores em memória também.
jest.mock("../../repositories/staging-valkey.repository");
jest.mock("../../services/gravar-staging.service");
jest.mock("../../services/validar-estacao.service");
jest.mock("../../services/registro-rejeicao.service");
jest.mock("../../services/registro-duplicada.service");
jest.mock("../../services/staging-publisher.service");

const AGORA = new Date("2026-11-16T10:00:00.000Z");
const relogio = () => AGORA;
const ESTACAO_A = "00000000-0000-4000-8000-00000000000a";
const ESTACAO_B = "00000000-0000-4000-8000-00000000000b";
const topico = (estacao: string): string => `pulso/estacoes/${estacao}/telemetria`;
const payloadValido = '{ "timestamp": "2026-10-14T12:00:00Z", "leituras": [{"sensor":"temperatura","valor":25}] }';

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

beforeEach(() => {
  jest.mocked(gravarBruta).mockResolvedValue("id-gerado");
  jest.mocked(listarRecebidas).mockResolvedValue([]);
  jest.mocked(conferirEstacao).mockResolvedValue(undefined);
  jest.mocked(gravarAceita).mockResolvedValue("recebida");
  jest.mocked(gravarRejeitada).mockResolvedValue("rejeitada");
  gravacaoMetricsService.reset();
  jest.spyOn(logger, "warn").mockImplementation(() => undefined);
  jest.spyOn(logger, "error").mockImplementation(() => undefined);
});

describe("receberMensagem", () => {
  const bruta: MensagemBruta = {
    topico: topico(ESTACAO_A),
    payloadBruto: "  conteúdo {não é json} ",
    recebidoEm: "2026-10-14T12:00:05.000Z",
  };

  describe("US-40 · Cenário 1 · gravação antes de tudo", () => {
    it("deve gravar no Valkey a mensagem exatamente como chegou e devolver o id quando ela é recebida do broker", async () => {
      // Dado (Arrange)
      // Quando (Act)
      const id = await receberMensagem(bruta);

      // Então (Assert)
      expect(gravarBruta).toHaveBeenCalledWith(bruta);
      expect(id).toBe("id-gerado");
    });

    it("deve começar a verificação só depois de gravar quando a mensagem é recebida", async () => {
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
});

describe("verificarMensagem", () => {
  describe("US-40 · Cenário 2 · recusada fica no Valkey com o motivo e não segue", () => {
    it("deve marcar recusada com o motivo, sem publicar, quando a bateria é 150", async () => {
      // Dado (Arrange)
      const mensagem = staging({
        payloadBruto: '{"timestamp":"2026-10-14T12:00:00Z","nivel_bateria":150,"leituras":[{"sensor":"T","valor":1}]}',
      });

      // Quando (Act)
      const resultado = await verificarMensagem(mensagem, relogio);

      // Então (Assert)
      expect(resultado).toBe("recusada");
      expect(encerrarSemPublicar).toHaveBeenCalledWith(mensagem.id, "recusada", AGORA, "Nível de bateria fora de 0 a 100");
      expect(marcarPendente).not.toHaveBeenCalled();
      expect(solicitarProcessamentoPendentes).not.toHaveBeenCalled();
      expect(registrarRejeicao).toHaveBeenCalledWith("Nível de bateria fora de 0 a 100", ESTACAO_A);
    });

    it("deve gravar a recusa na staging_telemetria com o id do Valkey quando o conteúdo não é JSON", async () => {
      // Dado (Arrange)
      const mensagem = staging({ payloadBruto: "  mensagem quebrada\n" });

      // Quando (Act)
      await verificarMensagem(mensagem, relogio);

      // Então (Assert)
      expect(gravarRejeitada).toHaveBeenCalledWith(
        { estacaoId: ESTACAO_A, topico: mensagem.topico, payloadBruto: "  mensagem quebrada\n", recebidoEm: mensagem.recebidoEm },
        "Payload malformado",
        mensagem.id,
      );
      expect(encerrarSemPublicar).toHaveBeenCalledWith(mensagem.id, "recusada", AGORA, "Payload malformado");
    });

    it("deve recusar com \"Estação desconhecida\" sem consultar a estação nem gravar no PostgreSQL quando o tópico não tem UUID", async () => {
      // Dado (Arrange)
      const mensagem = staging({ topico: "pulso/estacoes/est-001/telemetria" });

      // Quando (Act)
      const resultado = await verificarMensagem(mensagem, relogio);

      // Então (Assert)
      expect(resultado).toBe("recusada");
      expect(encerrarSemPublicar).toHaveBeenCalledWith(mensagem.id, "recusada", AGORA, "Estação desconhecida");
      expect(conferirEstacao).not.toHaveBeenCalled();
      expect(gravarRejeitada).not.toHaveBeenCalled();
    });

    it("deve somar em rejeitadasGravadas e não em mensagensGravadas quando a mensagem é recusada", async () => {
      // Dado (Arrange)
      const mensagem = staging({ payloadBruto: "não é JSON" });

      // Quando (Act)
      await verificarMensagem(mensagem, relogio);

      // Então (Assert)
      expect(gravacaoMetricsService.obterRejeitadasGravadas()).toBe(1);
      expect(gravacaoMetricsService.obterMensagensGravadas()).toBe(0);
    });

    it("deve não registrar duplicata quando a mensagem é recusada", async () => {
      // Dado (Arrange)
      // Quando (Act)
      await verificarMensagem(staging({ payloadBruto: "não é JSON" }), relogio);

      // Então (Assert)
      expect(registrarDuplicadaIgnorada).not.toHaveBeenCalled();
    });
  });

  describe("US-12 e US-28 · estação e horário lidos do Valkey", () => {
    it("deve conferir a estação com o UUID do tópico, o timestamp e o recebidoEm quando o payload é válido", async () => {
      // Dado (Arrange)
      const mensagem = staging();

      // Quando (Act)
      await verificarMensagem(mensagem, relogio);

      // Então (Assert)
      expect(conferirEstacao).toHaveBeenCalledWith(ESTACAO_A, "2026-10-14T12:00:00Z", mensagem.recebidoEm);
    });

    it.each(["Estação desconhecida", "Estação inativa", "Timestamp fora da faixa"])(
      "deve recusar com o motivo devolvido pela conferência quando ela recusa: %s",
      async (motivo) => {
        // Dado (Arrange)
        jest.mocked(conferirEstacao).mockResolvedValue(motivo);
        const mensagem = staging();

        // Quando (Act)
        const resultado = await verificarMensagem(mensagem, relogio);

        // Então (Assert)
        expect(resultado).toBe("recusada");
        expect(encerrarSemPublicar).toHaveBeenCalledWith(mensagem.id, "recusada", AGORA, motivo);
        expect(gravarRejeitada).toHaveBeenCalledWith(expect.objectContaining({ estacaoId: ESTACAO_A }), motivo, mensagem.id);
        expect(registrarRejeicao).toHaveBeenCalledWith(motivo, ESTACAO_A);
        expect(gravarAceita).not.toHaveBeenCalled();
      },
    );

    it("deve conferir o payload antes da estação quando o payload é malformado", async () => {
      // Dado (Arrange)
      // Quando (Act)
      await verificarMensagem(staging({ payloadBruto: "não é JSON" }), relogio);

      // Então (Assert)
      expect(conferirEstacao).not.toHaveBeenCalled();
      expect(registrarRejeicao).toHaveBeenCalledWith("Payload malformado", ESTACAO_A);
    });
  });

  describe("US-40 · aceita entra em staging:pendentes", () => {
    it("deve marcar pendente e somar em mensagensGravadas quando a mensagem é aceita", async () => {
      // Dado (Arrange)
      const mensagem = staging();

      // Quando (Act)
      const resultado = await verificarMensagem(mensagem, relogio);

      // Então (Assert)
      expect(resultado).toBe("pendente");
      expect(marcarPendente).toHaveBeenCalledWith(mensagem.id);
      expect(gravacaoMetricsService.obterMensagensGravadas()).toBe(1);
      expect(registrarRejeicao).not.toHaveBeenCalled();
      expect(registrarDuplicadaIgnorada).not.toHaveBeenCalled();
    });

    it("deve pedir a publicação depois de marcar pendente quando a mensagem é aceita", async () => {
      // Dado (Arrange)
      // Quando (Act)
      await verificarMensagem(staging(), relogio);

      // Então (Assert)
      const marcou = jest.mocked(marcarPendente).mock.invocationCallOrder[0];
      const pediu = jest.mocked(solicitarProcessamentoPendentes).mock.invocationCallOrder[0];
      expect(marcou).toBeLessThan(pediu);
    });

    it("deve gravar na staging_telemetria com o id do Valkey e o conteúdo como chegou quando a mensagem é aceita", async () => {
      // Dado (Arrange)
      const mensagem = staging();

      // Quando (Act)
      await verificarMensagem(mensagem, relogio);

      // Então (Assert)
      expect(gravarAceita).toHaveBeenCalledWith(
        { estacaoId: ESTACAO_A, topico: mensagem.topico, payloadBruto: payloadValido, recebidoEm: mensagem.recebidoEm },
        mensagem.id,
      );
    });
  });

  describe("US-13 · duplicata pelo índice da staging_telemetria (até a 40.04)", () => {
    it("deve marcar duplicada, registrar uma vez e não registrar rejeição quando o PostgreSQL acusa duplicata", async () => {
      // Dado (Arrange)
      jest.mocked(gravarAceita).mockResolvedValue("duplicata");
      const mensagem = staging();

      // Quando (Act)
      const resultado = await verificarMensagem(mensagem, relogio);

      // Então (Assert)
      expect(resultado).toBe("duplicada");
      expect(encerrarSemPublicar).toHaveBeenCalledWith(mensagem.id, "duplicada", AGORA);
      expect(marcarPendente).not.toHaveBeenCalled();
      expect(registrarDuplicadaIgnorada).toHaveBeenCalledTimes(1);
      expect(registrarDuplicadaIgnorada).toHaveBeenCalledWith({ estacaoId: ESTACAO_A, timestamp: "2026-10-14T12:00:00Z" });
      expect(registrarRejeicao).not.toHaveBeenCalled();
      expect(gravacaoMetricsService.obterMensagensGravadas()).toBe(0);
    });
  });

  describe("US-40 · Cenário 7 · expiração a partir do relógio", () => {
    it("deve passar o agora injetado para a expiração quando a mensagem é recusada", async () => {
      // Dado (Arrange)
      const mensagem = staging({ payloadBruto: "não é JSON" });

      // Quando (Act)
      await verificarMensagem(mensagem, relogio);

      // Então (Assert)
      expect(encerrarSemPublicar).toHaveBeenCalledWith(mensagem.id, "recusada", AGORA, "Payload malformado");
    });

    it("deve passar o agora injetado para a expiração quando a mensagem é duplicada", async () => {
      // Dado (Arrange)
      jest.mocked(gravarAceita).mockResolvedValue("duplicata");
      const mensagem = staging();

      // Quando (Act)
      await verificarMensagem(mensagem, relogio);

      // Então (Assert)
      expect(encerrarSemPublicar).toHaveBeenCalledWith(mensagem.id, "duplicada", AGORA);
    });
  });

  describe("US-40 · Cenário 4 · PostgreSQL fora não trava o Valkey nem a publicação", () => {
    it("deve marcar pendente, pedir a publicação e registrar no log quando a gravação da aceita falha", async () => {
      // Dado (Arrange)
      jest.mocked(gravarAceita).mockRejectedValue(new Error("Banco indisponível"));
      const mensagem = staging();

      // Quando (Act)
      const resultado = await verificarMensagem(mensagem, relogio);

      // Então (Assert)
      expect(resultado).toBe("pendente");
      expect(marcarPendente).toHaveBeenCalledWith(mensagem.id);
      expect(solicitarProcessamentoPendentes).toHaveBeenCalled();
      expect(registrarDuplicadaIgnorada).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        "PostgreSQL indisponível ao gravar a aceita e o último sinal; a leitura segue pelo Valkey",
        { stagingId: mensagem.id, erro: "Banco indisponível" },
      );
    });

    it("deve marcar recusada com o motivo e registrar no log quando a gravação da recusa falha", async () => {
      // Dado (Arrange)
      jest.mocked(gravarRejeitada).mockRejectedValue(new Error("Banco indisponível"));
      const mensagem = staging({ payloadBruto: "não é JSON" });

      // Quando (Act)
      const resultado = await verificarMensagem(mensagem, relogio);

      // Então (Assert)
      expect(resultado).toBe("recusada");
      expect(encerrarSemPublicar).toHaveBeenCalledWith(mensagem.id, "recusada", AGORA, "Payload malformado");
      expect(registrarRejeicao).toHaveBeenCalledWith("Payload malformado", ESTACAO_A);
      expect(logger.error).toHaveBeenCalledWith(
        "PostgreSQL indisponível ao gravar a recusada; a leitura segue pelo Valkey",
        expect.objectContaining({ stagingId: mensagem.id }),
      );
    });

    it("deve lançar, como erro temporário, sem gravar nem decidir quando a conferência da estação falha", async () => {
      // Dado (Arrange)
      const erro = new Error("Banco indisponível");
      jest.mocked(conferirEstacao).mockRejectedValue(erro);

      // Quando (Act)
      const resultado = verificarMensagem(staging(), relogio);

      // Então (Assert)
      await expect(resultado).rejects.toBe(erro);
      expect(gravarAceita).not.toHaveBeenCalled();
      expect(registrarRejeicao).not.toHaveBeenCalled();
      expect(encerrarSemPublicar).not.toHaveBeenCalled();
      expect(marcarPendente).not.toHaveBeenCalled();
    });
  });
});

describe("verificarRecebidas", () => {
  function fila(...mensagens: MensagemStaging[]): void {
    jest.mocked(listarRecebidas).mockResolvedValue(mensagens.map((m) => m.id));
    jest.mocked(lerMensagem).mockImplementation(async (id) => mensagens.find((m) => m.id === id) ?? null);
  }

  describe("US-40 · fila de verificação: uma mensagem não trava as outras", () => {
    it("deve manter recebida e seguir para as outras estações quando a conferência falha para uma estação", async () => {
      // Dado (Arrange)
      fila(staging({ id: "a1", topico: topico(ESTACAO_A) }), staging({ id: "b1", topico: topico(ESTACAO_B) }));
      jest.mocked(conferirEstacao).mockImplementation(async (id) => {
        if (id === ESTACAO_A) throw new Error("Banco indisponível");
        return undefined;
      });

      // Quando (Act)
      await verificarRecebidas();

      // Então (Assert)
      expect(jest.mocked(marcarPendente).mock.calls).toEqual([["b1"]]);
      expect(encerrarSemPublicar).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        "Verificação adiada para a próxima rodada",
        expect.objectContaining({ stagingId: "a1" }),
      );
    });

    it("deve adiar as mensagens seguintes da mesma estação quando uma dela fica adiada", async () => {
      // Dado (Arrange)
      fila(
        staging({ id: "a1", topico: topico(ESTACAO_A) }),
        staging({ id: "a2", topico: topico(ESTACAO_A) }),
        staging({ id: "b1", topico: topico(ESTACAO_B) }),
      );
      jest.mocked(conferirEstacao).mockRejectedValueOnce(new Error("Banco indisponível")).mockResolvedValue(undefined);

      // Quando (Act)
      await verificarRecebidas();

      // Então (Assert)
      expect(jest.mocked(marcarPendente).mock.calls).toEqual([["b1"]]);
    });

    it("deve verificar a mensagem adiada na rodada seguinte quando o PostgreSQL volta", async () => {
      // Dado (Arrange)
      fila(staging({ id: "a1" }));
      jest.mocked(conferirEstacao).mockRejectedValueOnce(new Error("Banco indisponível")).mockResolvedValue(undefined);
      await verificarRecebidas();

      // Quando (Act)
      await verificarRecebidas();

      // Então (Assert)
      expect(marcarPendente).toHaveBeenCalledWith("a1");
    });

    it("deve pular o id quando a mensagem não existe mais no Valkey", async () => {
      // Dado (Arrange)
      jest.mocked(listarRecebidas).mockResolvedValue(["sumiu"]);
      jest.mocked(lerMensagem).mockResolvedValue(null);

      // Quando (Act)
      await verificarRecebidas();

      // Então (Assert)
      expect(conferirEstacao).not.toHaveBeenCalled();
    });

    it("deve registrar no log e não lançar quando o Valkey falha ao ler a fila", async () => {
      // Dado (Arrange)
      jest.mocked(listarRecebidas).mockRejectedValue(new Error("Valkey indisponível"));

      // Quando (Act)
      const resultado = verificarRecebidas();

      // Então (Assert)
      await expect(resultado).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalledWith("Falha ao ler a fila de verificação no Valkey", { erro: "Valkey indisponível" });
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
});

describe("iniciarVerificacao", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    encerrarVerificacao();
    jest.useRealTimers();
  });

  it("deve rodar uma verificação na hora e outra a cada intervalo quando é iniciada", async () => {
    // Dado (Arrange)
    // Quando (Act)
    iniciarVerificacao(10000);
    await jest.advanceTimersByTimeAsync(20000);

    // Então (Assert)
    expect(listarRecebidas).toHaveBeenCalledTimes(3);
  });
});

describe("encerrarVerificacao", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("deve parar as rodadas periódicas quando é encerrada", async () => {
    // Dado (Arrange)
    iniciarVerificacao(10000);
    await jest.advanceTimersByTimeAsync(0);

    // Quando (Act)
    encerrarVerificacao();
    await jest.advanceTimersByTimeAsync(30000);

    // Então (Assert)
    expect(listarRecebidas).toHaveBeenCalledTimes(1);
  });
});
