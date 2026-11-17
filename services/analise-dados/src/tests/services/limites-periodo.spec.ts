import {
  calcularDiasSolicitados,
  obterLimiteMaximoDias,
  validarPeriodoPorPerfil,
  LIMITES_DIAS_POR_PERFIL,
  PERFIS,
} from "../../config/limites-periodo";

describe("Configuração de Limites de Período (Task 42.04 / ELEM-274)", () => {
  it("deve definir corretamente os limites para cada perfil na tabela central", () => {
    expect(LIMITES_DIAS_POR_PERFIL[PERFIS.ANONIMO]).toBe(7);
    expect(LIMITES_DIAS_POR_PERFIL[PERFIS.MUNICIPE]).toBe(30);
    expect(LIMITES_DIAS_POR_PERFIL[PERFIS.GESTOR_PUBLICO]).toBeNull();
    expect(LIMITES_DIAS_POR_PERFIL[PERFIS.ADMINISTRADOR]).toBeNull();
  });

  describe("calcularDiasSolicitados", () => {
    it("converte strings padrão como 24h, 7d, 30d", () => {
      expect(calcularDiasSolicitados("24h")).toBe(1);
      expect(calcularDiasSolicitados("7d")).toBe(7);
      expect(calcularDiasSolicitados("30d")).toBe(30);
    });

    it("interpreta regex de dias e horas customizadas", () => {
      expect(calcularDiasSolicitados("15d")).toBe(15);
      expect(calcularDiasSolicitados("48h")).toBe(2);
    });

    it("calcula a diferença entre datas data_inicio e data_fim", () => {
      const dias = calcularDiasSolicitados(
        undefined,
        "2026-01-01T00:00:00Z",
        "2026-01-11T00:00:00Z"
      );
      expect(dias).toBe(10);
    });

    it("retorna 1 dia como padrão se nenhum parâmetro for fornecido", () => {
      expect(calcularDiasSolicitados()).toBe(1);
    });
  });

  describe("obterLimiteMaximoDias", () => {
    it("retorna 7 dias para usuário sem papel (anônimo)", () => {
      expect(obterLimiteMaximoDias(undefined)).toBe(7);
      expect(obterLimiteMaximoDias("")).toBe(7);
    });

    it("retorna 30 dias para MUNICIPE", () => {
      expect(obterLimiteMaximoDias("MUNICIPE")).toBe(30);
    });

    it("retorna null (sem limite) para GESTOR_PUBLICO e ADMINISTRADOR", () => {
      expect(obterLimiteMaximoDias("GESTOR_PUBLICO")).toBeNull();
      expect(obterLimiteMaximoDias("ADMINISTRADOR")).toBeNull();
    });
  });

  describe("validarPeriodoPorPerfil", () => {
    it("permite até 7 dias para anônimo e bloqueia acima disso", () => {
      const ok = validarPeriodoPorPerfil(undefined, 7);
      expect(ok.valido).toBe(true);

      const excesso = validarPeriodoPorPerfil(undefined, 8);
      expect(excesso.valido).toBe(false);
      expect(excesso.limiteDias).toBe(7);
      expect(excesso.mensagemErro).toContain("7 dias");
    });

    it("permite até 30 dias para MUNICIPE e bloqueia acima disso", () => {
      const ok = validarPeriodoPorPerfil("MUNICIPE", 30);
      expect(ok.valido).toBe(true);

      const excesso = validarPeriodoPorPerfil("MUNICIPE", 31);
      expect(excesso.valido).toBe(false);
      expect(excesso.limiteDias).toBe(30);
      expect(excesso.mensagemErro).toContain("30 dias");
    });

    it("permite períodos ilimitados para GESTOR_PUBLICO e ADMINISTRADOR", () => {
      const gestor = validarPeriodoPorPerfil("GESTOR_PUBLICO", 365);
      expect(gestor.valido).toBe(true);
      expect(gestor.limiteDias).toBeNull();

      const admin = validarPeriodoPorPerfil("ADMINISTRADOR", 1000);
      expect(admin.valido).toBe(true);
      expect(admin.limiteDias).toBeNull();
    });
  });
});
