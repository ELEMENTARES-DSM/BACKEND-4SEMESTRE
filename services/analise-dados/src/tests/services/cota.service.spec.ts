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

describe("Cotas e Janelas de Tempo (Task 42.05 / ELEM-275)", () => {
  beforeEach(() => {
    limparMemoryStore();
  });

  describe("Cálculo de Formatos de Chaves ISO", () => {
    it("deve gerar formato AAAA-Wss para a semana", () => {
      const data = new Date("2026-11-17T12:00:00Z");
      const semana = obterAnoSemanaIso(data);
      expect(semana).toMatch(/^2026-W\d{2}$/);
    });

    it("deve gerar formato AAAA-MM para o mês", () => {
      const data = new Date("2026-11-17T12:00:00Z");
      expect(obterAnoMes(data)).toBe("2026-11");
    });

    it("deve calcular a renovação semanal para a próxima segunda-feira", () => {
      // 2026-11-17 é terça-feira
      const data = new Date("2026-11-17T10:00:00Z");
      const renova = obterDataRenovacaoSemana(data);
      expect(renova.getUTCDay()).toBe(1); // Segunda-feira
      expect(renova.getTime()).toBeGreaterThan(data.getTime());
    });

    it("deve calcular a renovação mensal para o dia 1 do mês seguinte", () => {
      const data = new Date("2026-11-17T10:00:00Z");
      const renova = obterDataRenovacaoMes(data);
      expect(renova.getUTCDate()).toBe(1);
      expect(renova.getUTCMonth()).toBe(11); // Dezembro (índice 11)
    });
  });

  describe("verificarEDebitarCota", () => {
    it("permite requisições sem limite para ADMINISTRADOR e GESTOR_PUBLICO", async () => {
      const resAdmin = await verificarEDebitarCota("admin-1", "ADMINISTRADOR");
      expect(resAdmin.permitido).toBe(true);
      expect(resAdmin.semanaRestante).toBe("ilimitado");

      const resGestor = await verificarEDebitarCota("gestor-1", "GESTOR_PUBLICO");
      expect(resGestor.permitido).toBe(true);
      expect(resGestor.mesRestante).toBe("ilimitado");
    });

    it("debita da cota do MUNICIPE e atualiza saldo restante", async () => {
      const res = await verificarEDebitarCota("municipe-1", "MUNICIPE");
      expect(res.permitido).toBe(true);
      expect(res.semanaRestante).toBe(1999);
      expect(res.mesRestante).toBe(5999);
    });

    it("responde não permitido e indica renovação ao estourar cota", async () => {
      const limiteOriginal = COTAS_POR_PERFIL.MUNICIPE!.semanal;
      try {
        // Reduz temporariamente para teste
        COTAS_POR_PERFIL.MUNICIPE!.semanal = 2;

        await verificarEDebitarCota("municipe-estouro", "MUNICIPE"); // 1º uso
        await verificarEDebitarCota("municipe-estouro", "MUNICIPE"); // 2º uso

        const terceiro = await verificarEDebitarCota("municipe-estouro", "MUNICIPE");
        expect(terceiro.permitido).toBe(false);
        expect(terceiro.motivo).toBe("semana");
        expect(terceiro.renovaEm).toBeDefined();
        expect(terceiro.semanaRestante).toBe(0);
      } finally {
        COTAS_POR_PERFIL.MUNICIPE!.semanal = limiteOriginal;
      }
    });
  });
});
