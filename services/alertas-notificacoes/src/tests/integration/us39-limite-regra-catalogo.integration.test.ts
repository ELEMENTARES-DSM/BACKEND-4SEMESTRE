import { subir } from "../helpers/servidor-teste";
import { randomUUID } from "node:crypto";
import app from "../../app";
import { pool } from "../../config/db";
import { cadastrarGrandeza, cadastrarSensor, prepararSchemaAlarmes } from "./helpers/banco-alarmes";

// US-39 (ELEM-266): o limite da regra é conferido contra a faixa da grandeza no
// catálogo, por JOIN. Execute com ALERTAS_TEST_DATABASE_URL apontando para uma
// instância de teste.
const integration = describe;

integration("US-39 - limite da regra de alerta contra a faixa do catálogo (PostgreSQL)", () => {
  const schema = `alertas_us39_${randomUUID().replaceAll("-", "")}`;
  const SJC = "São José dos Campos";
  const gestor = { papel: "GESTOR_PUBLICO" as const, municipio: SJC };
  let api: Awaited<ReturnType<typeof subir>>;

  const regra = (sensorId: string, valorLimite: number) => ({
    sensor_id: sensorId,
    nome: `Regra ${randomUUID().slice(0, 6)}`,
    operador: ">=",
    valor_limite: valorLimite,
    severidade: "CRITICO",
  });

  const totalDeRegras = async () => {
    const { rows } = await pool.query<{ total: number }>("SELECT count(*)::int AS total FROM regras_alerta");
    return rows[0].total;
  };

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
  });

  it("deve aceitar o limite na borda e recusar logo depois com 400 (temperatura de -50 a 60)", async () => {
    // Dado
    const { sensorId } = await cadastrarSensor(
      pool,
      { codigo: "SJC-001", nome: "Estação Centro", municipio: SJC },
      { codigo: "TEMP-01", tipo: "Temperatura", unidade: "°C", faixaMin: "-50", faixaMax: "60" }
    );

    // Quando
    const noTeto = await api.post("/alertas/regras-alerta", regra(sensorId, 60), gestor);
    const noPiso = await api.post("/alertas/regras-alerta", regra(sensorId, -50), gestor);
    const acima = await api.post("/alertas/regras-alerta", regra(sensorId, 60.01), gestor);
    const abaixo = await api.post("/alertas/regras-alerta", regra(sensorId, -50.01), gestor);

    // Então
    expect([noTeto.status, noPiso.status]).toEqual([201, 201]);
    expect([acima.status, abaixo.status]).toEqual([400, 400]);
    expect(acima.corpo.message).toBe("O valor limite para sensores de Temperatura deve estar entre -50 e 60 °C.");
    expect(await totalDeRegras()).toBe(2);
  });

  it("deve conferir a direção do vento (0 a 360), que não tinha faixa no código", async () => {
    // Dado
    const { sensorId } = await cadastrarSensor(
      pool,
      { codigo: "SJC-001", nome: "Estação Centro", municipio: SJC },
      { codigo: "DIR-01", tipo: "Direção do Vento", unidade: "°", faixaMin: "0", faixaMax: "360" }
    );

    // Quando / Então
    expect((await api.post("/alertas/regras-alerta", regra(sensorId, 360), gestor)).status).toBe(201);
    expect((await api.post("/alertas/regras-alerta", regra(sensorId, 361), gestor)).status).toBe(400);
  });

  it("deve usar a faixa de uma grandeza nova cadastrada pelo Administrador, sem mudar o código", async () => {
    // Dado
    const { sensorId } = await cadastrarSensor(
      pool,
      { codigo: "SJC-001", nome: "Estação Centro", municipio: SJC },
      { codigo: "NEB-01", tipo: "Nebulosidade", unidade: "oitavos", faixaMin: "0", faixaMax: "8" }
    );

    // Quando / Então
    expect((await api.post("/alertas/regras-alerta", regra(sensorId, 8), gestor)).status).toBe(201);
    expect((await api.post("/alertas/regras-alerta", regra(sensorId, 9), gestor)).status).toBe(400);
  });

  it("deve aplicar a faixa alterada às regras novas e manter as regras já cadastradas", async () => {
    // Dado: umidade de 0 a 100 e uma regra de 90 já cadastrada
    const { sensorId } = await cadastrarSensor(
      pool,
      { codigo: "SJC-001", nome: "Estação Centro", municipio: SJC },
      { codigo: "UR-01", tipo: "Umidade Relativa", unidade: "%", faixaMin: "0", faixaMax: "100" }
    );
    expect((await api.post("/alertas/regras-alerta", regra(sensorId, 90), gestor)).status).toBe(201);

    // Quando: o Administrador baixa o máximo para 80
    await cadastrarGrandeza(pool, { nome: "Umidade Relativa", unidade: "%", faixaMin: "0", faixaMax: "80" });
    const nova = await api.post("/alertas/regras-alerta", regra(sensorId, 90), gestor);

    // Então: a regra nova de 90 é recusada, e a antiga de 90 continua gravada
    expect(nova.status).toBe(400);
    expect(await totalDeRegras()).toBe(1);
  });

  it("deve seguir respondendo 422 para sensor inativo", async () => {
    // Dado
    const { sensorId } = await cadastrarSensor(
      pool,
      { codigo: "SJC-001", nome: "Estação Centro", municipio: SJC },
      { codigo: "UR-01", tipo: "Umidade Relativa", unidade: "%", faixaMin: "0", faixaMax: "100" }
    );
    await pool.query("UPDATE sensores SET status = 'Inativo' WHERE id = $1", [sensorId]);

    // Quando
    const { status } = await api.post("/alertas/regras-alerta", regra(sensorId, 50), gestor);

    // Então
    expect(status).toBe(422);
  });
});
