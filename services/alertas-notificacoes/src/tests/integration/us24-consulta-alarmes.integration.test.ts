import { subir } from "../helpers/servidor-teste";
import { randomUUID } from "node:crypto";
import app from "../../app";
import { pool } from "../../config/db";
import { cadastrarSensor, gravarAlarme, prepararSchemaAlarmes } from "./helpers/banco-alarmes";

// US-24 (TASK 24.01) pelas rotas reais, com PostgreSQL real. Execute com
// ALERTAS_TEST_DATABASE_URL apontando para uma instância de teste.
const databaseUrl = process.env.ALERTAS_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("US-24 - consulta de alarmes (PostgreSQL)", () => {
  const schema = `alertas_us24_${randomUUID().replaceAll("-", "")}`;
  const SJC = "São José dos Campos";
  const gestorSjc = { papel: "GESTOR_PUBLICO" as const, municipio: SJC };
  const gestorSp = { papel: "GESTOR_PUBLICO" as const, municipio: "São Paulo" };
  let api: Awaited<ReturnType<typeof subir>>;
  let sjc: { estacaoId: string; sensorId: string };
  let sp: { estacaoId: string; sensorId: string };

  const hoje = (hora: string) => `2026-10-24T${hora}.000-03:00`;
  const ontem = (hora: string) => `2026-10-23T${hora}.000-03:00`;

  beforeAll(async () => {
    await prepararSchemaAlarmes(pool, schema);
    api = await subir(app);
  });

  afterAll(async () => {
    try {
      await api.fechar();
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await pool.end();
    }
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE alarmes, medidas, regras_alerta, sensores, estacoes CASCADE");
    sjc = await cadastrarSensor(pool, { codigo: "SJC-001", nome: "Estação Centro", municipio: SJC }, { codigo: "PM25-01", tipo: "PM2.5", unidade: "µg/m³" });
    sp = await cadastrarSensor(pool, { codigo: "SP-001", nome: "Estação Sé", municipio: "São Paulo" }, { codigo: "PM25-01", tipo: "PM2.5", unidade: "µg/m³" });
  });

  const alarmeSjc = (severidade: "ATENCAO" | "ALERTA" | "CRITICO", lidoEm: string, situacao: "aberto" | "normalizado" = "aberto") =>
    gravarAlarme(pool, {
      ...sjc,
      municipio: SJC,
      regraNome: `PM2.5 ${severidade.toLowerCase()} ${randomUUID().slice(0, 4)}`,
      severidade,
      valor: "52.300000",
      limite: "50.00",
      lidoEm,
      situacao,
    });

  it("cenário 1: a lista traz data e hora, estação, sensor, regra, valor × limite, severidade e situação", async () => {
    const id = await alarmeSjc("CRITICO", hoje("10:00:00"));

    const { status, corpo } = await api.get("/alertas/alarmes", gestorSjc);

    expect(status).toBe(200);
    expect(corpo).toEqual([
      expect.objectContaining({
        id,
        estacao_codigo: "SJC-001",
        estacao_nome: "Estação Centro",
        sensor_codigo: "PM25-01",
        sensor_tipo: "PM2.5",
        sensor_unidade_medida: "µg/m³",
        regra_nome: expect.stringContaining("PM2.5 critico"),
        valor: 52.3,
        limite: 50,
        operador: ">=",
        severidade: "CRITICO",
        situacao: "aberto",
        municipio: SJC,
        lido_em: "2026-10-24T13:00:00.000Z",
        normalizado_em: null,
      }),
    ]);
  });

  it("cenário 2: CRITICO e período de hoje combinados trazem só o que atende aos dois filtros", async () => {
    const certo = await alarmeSjc("CRITICO", hoje("09:00:00"));
    await alarmeSjc("CRITICO", ontem("09:00:00"));
    await alarmeSjc("ALERTA", hoje("09:30:00"));

    const { corpo } = await api.get(
      `/alertas/alarmes?severidade=CRITICO&de=${encodeURIComponent(hoje("00:00:00"))}&ate=${encodeURIComponent("2026-10-24T23:59:59.999-03:00")}`,
      gestorSjc
    );

    expect(corpo.map((a: { id: string }) => a.id)).toEqual([certo]);
  });

  it("cenário 3: com 2 CRITICO e 1 ALERTA abertos o resumo bate com a lista filtrada pelos abertos", async () => {
    await alarmeSjc("CRITICO", hoje("08:00:00"));
    await alarmeSjc("CRITICO", hoje("08:10:00"));
    await alarmeSjc("ALERTA", hoje("08:20:00"));
    await alarmeSjc("CRITICO", hoje("07:00:00"), "normalizado");
    await gravarAlarme(pool, { ...sp, municipio: "São Paulo", regraNome: "SP", severidade: "CRITICO", valor: "60", limite: "50", lidoEm: hoje("08:00:00") });

    const resumo = await api.get("/alertas/alarmes/resumo", gestorSjc);
    const abertos = await api.get("/alertas/alarmes?situacao=aberto", gestorSjc);

    expect(resumo.corpo).toEqual({ abertos: { ATENCAO: 0, ALERTA: 1, CRITICO: 2 }, total: 3 });
    expect(abertos.corpo).toHaveLength(resumo.corpo.total);
  });

  it("cenário 4: gestor de São Paulo buscando um alarme de São José dos Campos recebe 404", async () => {
    const id = await alarmeSjc("CRITICO", hoje("10:00:00"));

    const { status, corpo } = await api.get(`/alertas/alarmes/${id}`, gestorSp);

    expect(status).toBe(404);
    expect(corpo).toEqual({ message: "Alarme não encontrado." });
    expect((await api.get(`/alertas/alarmes/${id}`, gestorSjc)).status).toBe(200);
  });

  it("cenário 5: pesquisador não consulta alarmes", async () => {
    const pesquisador = { papel: "PESQUISADOR" as const, municipio: SJC };

    expect((await api.get("/alertas/alarmes", pesquisador)).status).toBe(403);
    expect((await api.get("/alertas/alarmes/resumo", pesquisador)).status).toBe(403);
  });

  it("cenário 6: sem alarmes no período a lista vem vazia, com 200", async () => {
    await alarmeSjc("CRITICO", ontem("10:00:00"));

    const { status, corpo } = await api.get(`/alertas/alarmes?de=${encodeURIComponent(hoje("00:00:00"))}`, gestorSjc);

    expect(status).toBe(200);
    expect(corpo).toEqual([]);
  });

  it("o gestor não vê alarmes de outro município; o administrador vê todos e filtra por estação", async () => {
    await alarmeSjc("CRITICO", hoje("10:00:00"));
    await gravarAlarme(pool, { ...sp, municipio: "São Paulo", regraNome: "SP", severidade: "ATENCAO", valor: "40", limite: "35", lidoEm: hoje("10:00:00") });

    expect((await api.get("/alertas/alarmes", gestorSp)).corpo.map((a: { municipio: string }) => a.municipio)).toEqual(["São Paulo"]);
    expect((await api.get("/alertas/alarmes", { papel: "ADMINISTRADOR" })).corpo).toHaveLength(2);
    expect((await api.get(`/alertas/alarmes?estacao_id=${sp.estacaoId}`, { papel: "ADMINISTRADOR" })).corpo).toHaveLength(1);
  });

  it("a lista vem do mais recente para o mais antigo", async () => {
    const antigo = await alarmeSjc("ATENCAO", hoje("06:00:00"));
    const novo = await alarmeSjc("ALERTA", hoje("11:00:00"));

    const { corpo } = await api.get("/alertas/alarmes", gestorSjc);

    expect(corpo.map((a: { id: string }) => a.id)).toEqual([novo, antigo]);
  });
});
