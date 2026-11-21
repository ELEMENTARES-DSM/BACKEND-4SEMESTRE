import {
  obterAnoSemanaIso,
  obterAnoMes,
  obterDataRenovacaoSemana,
  obterDataRenovacaoMes,
  COTAS_POR_PERFIL,
} from "../../config/cotas";
import {
  verificarEDebitarCota,
  limparMemoryStore,
} from "../../services/cota.service";

describe("cota.service (US-42)", () => {
  beforeEach(() => {
    limparMemoryStore();
  });

  describe("Cálculo de Formatos de Chaves ISO", () => {
    it("deve gerar formato AAAA-Wss quando calcula a semana ISO", () => {
      // Dado: uma data válida
      const data = new Date("2026-11-17T12:00:00Z");
      // Quando: calcula o identificador da semana ISO
      const semana = obterAnoSemanaIso(data);
      // Então: segue o padrão AAAA-Wss
      expect(semana).toMatch(/^2026-W\d{2}$/);
    });

    it("deve gerar formato AAAA-MM quando calcula o mês", () => {
      // Dado: uma data válida
      const data = new Date("2026-11-17T12:00:00Z");
      // Quando: calcula o identificador do mês
      // Então: retorna 2026-11
      expect(obterAnoMes(data)).toBe("2026-11");
    });

    it("deve calcular a renovação semanal para a próxima segunda-feira quando consultada na terça", () => {
      // Dado: terça-feira 2026-11-17
      const data = new Date("2026-11-17T10:00:00Z");
      // Quando: calcula a próxima renovação semanal
      const renova = obterDataRenovacaoSemana(data);
      // Então: cai na próxima segunda-feira UTC
      expect(renova.getUTCDay()).toBe(1);
      expect(renova.getTime()).toBeGreaterThan(data.getTime());
    });

    it("deve calcular a renovação mensal para o dia 1 do mês seguinte quando consultada no mês atual", () => {
      // Dado: uma data em novembro
      const data = new Date("2026-11-17T10:00:00Z");
      // Quando: calcula a próxima renovação mensal
      const renova = obterDataRenovacaoMes(data);
      // Então: cai em 1º de dezembro UTC
      expect(renova.getUTCDate()).toBe(1);
      expect(renova.getUTCMonth()).toBe(11);
    });
  });

  describe("verificarEDebitarCota", () => {
    it("deve permitir requisições sem limite quando o perfil é ADMINISTRADOR ou GESTOR_PUBLICO", async () => {
      // Dado/Quando: usuários ilimitados fazem pedidos
      const resAdmin = await verificarEDebitarCota("admin-1", "ADMINISTRADOR");
      const resGestor = await verificarEDebitarCota("gestor-1", "GESTOR_PUBLICO");
      // Então: são permitidos com saldo ilimitado
      expect(resAdmin.permitido).toBe(true);
      expect(resAdmin.semanaRestante).toBe("ilimitado");
      expect(resGestor.permitido).toBe(true);
      expect(resGestor.mesRestante).toBe("ilimitado");
    });

    it("deve debitar da cota do MUNICIPE e atualizar saldo restante quando faz um pedido", async () => {
      // Dado: usuário MUNICIPE sem uso prévio
      // Quando: faz um pedido
      const res = await verificarEDebitarCota("municipe-1", "MUNICIPE");
      // Então: debita 1 da semana e 1 do mês
      expect(res.permitido).toBe(true);
      expect(res.semanaRestante).toBe(1999);
      expect(res.mesRestante).toBe(5999);
    });

    it("deve recusar e indicar renovação quando estoura a cota semanal", async () => {
      const limiteOriginal = COTAS_POR_PERFIL.MUNICIPE!.semanal;
      try {
        // Dado: cota semanal reduzida para 2
        COTAS_POR_PERFIL.MUNICIPE!.semanal = 2;

        await verificarEDebitarCota("municipe-estouro", "MUNICIPE");
        await verificarEDebitarCota("municipe-estouro", "MUNICIPE");

        // Quando: vem o 3º pedido da semana
        const terceiro = await verificarEDebitarCota("municipe-estouro", "MUNICIPE");
        // Então: bloqueia pela semana com renovaEm
        expect(terceiro.permitido).toBe(false);
        expect(terceiro.motivo).toBe("semana");
        expect(terceiro.renovaEm).toBeDefined();
        expect(terceiro.semanaRestante).toBe(0);
      } finally {
        COTAS_POR_PERFIL.MUNICIPE!.semanal = limiteOriginal;
      }
    });

    it("deve recusar pelo motivo mês quando a cota mensal é esgotada", async () => {
      const limiteOriginal = COTAS_POR_PERFIL.MUNICIPE!.mensal;
      try {
        // Dado: cota mensal de 2 e semanal folgada
        COTAS_POR_PERFIL.MUNICIPE!.mensal = 2;
        await verificarEDebitarCota("municipe-mes", "MUNICIPE");
        await verificarEDebitarCota("municipe-mes", "MUNICIPE");
        // Quando: vem o 3º pedido do mês
        const terceiro = await verificarEDebitarCota("municipe-mes", "MUNICIPE");
        // Então: bloqueia pelo mês
        expect(terceiro.permitido).toBe(false);
        expect(terceiro.motivo).toBe("mes");
        expect(terceiro.renovaEm).toBeDefined();
      } finally {
        COTAS_POR_PERFIL.MUNICIPE!.mensal = limiteOriginal;
      }
    });

    it("deve tratar papel desconhecido como MUNICIPE quando não está na tabela", async () => {
      // Dado: um papel que não está na tabela de cotas
      // Quando: faz um pedido
      const res = await verificarEDebitarCota("papel-antigo", "PESQUISADOR");
      // Então: recebe a cota de MUNICIPE, e não é ilimitado
      expect(res.semanaRestante).toBe(1999);
    });

    it("deve lançar erro quando o Valkey está fechado fora dos testes", async () => {
      const ambienteOriginal = process.env.NODE_ENV;
      try {
        // Dado: ambiente de produção
        process.env.NODE_ENV = "production";
        // Quando/Então: o débito falha, para o middleware responder 503
        await expect(verificarEDebitarCota("municipe-prod", "MUNICIPE")).rejects.toThrow("Valkey indisponível");
      } finally {
        process.env.NODE_ENV = ambienteOriginal;
      }
    });
  });
});
