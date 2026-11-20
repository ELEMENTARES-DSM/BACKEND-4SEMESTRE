import { randomUUID } from "node:crypto";
import { describe, it, expect, jest, beforeAll, afterAll, beforeEach } from "@jest/globals";
import { pool } from "../../config/db";
import { processarEventoTelemetria } from "../../services/processar-telemetria.service";
import logger from "../../utils/logger";
import {
  cadastrarEstacao,
  cadastrarGrandeza,
  cadastrarSensor,
  prepararSchemaValidacao,
} from "./helpers/banco-validacao";

// US-39 (ELEM-265): a faixa física vem do catálogo tipos_sensor, por JOIN, na
// consulta que traz o sensor. Execute com VALIDACAO_TEST_DATABASE_URL apontando
// para uma instância de teste (não precisa de RabbitMQ).
const databaseUrl = process.env.VALIDACAO_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("US-39 - faixa física do catálogo (PostgreSQL)", () => {
  const schema = `validacao_us39_${randomUUID().replaceAll("-", "")}`;
  let estacao: string;
  let proximoUnixtime: number;

  const enviar = async (codigo: string, valor: number) => {
    proximoUnixtime += 1;
    await processarEventoTelemetria(
      {
        staging_id: randomUUID(),
        estacao_uuid: estacao,
        unixtime: proximoUnixtime,
        leituras: [{ sensor: codigo, valor }],
      },
      { dbPool: pool },
    );
    return proximoUnixtime;
  };

  const medida = async (sensorId: string, unixtime: number) => {
    const { rows } = await pool.query<{ valor: string; valor_bruto: string; valida: boolean }>(
      "SELECT valor, valor_bruto, valida FROM medidas WHERE sensor_id = $1 AND unixtime = $2",
      [sensorId, unixtime],
    );
    return rows[0];
  };

  beforeAll(async () => {
    jest.spyOn(logger, "info").mockImplementation(() => undefined);
    jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    await prepararSchemaValidacao(pool, schema);
  });

  afterAll(async () => {
    try {
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await pool.end();
      jest.restoreAllMocks();
    }
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE medidas, sensores, estacoes CASCADE");
    estacao = randomUUID();
    proximoUnixtime = Math.floor(Date.now() / 1000) - 3600;
    await cadastrarEstacao(pool, estacao);
  });

  it("Cenário 2: precipitação 12,4 mm é gravada como 12,40 e válida", async () => {
    // Dado
    const sensor = await cadastrarSensor(pool, { estacaoId: estacao, codigo: "CHUVA-01", tipo: "Precipitação" });

    // Quando
    const unixtime = await enviar("CHUVA-01", 12.4);

    // Então
    const gravada = await medida(sensor, unixtime);
    expect(Number(gravada.valor)).toBe(12.4);
    expect(gravada.valida).toBe(true);
  });

  it("Cenário 3: umidade 120 fica inválida pela faixa do catálogo e a medida é gravada", async () => {
    // Dado
    const sensor = await cadastrarSensor(pool, { estacaoId: estacao, codigo: "UR-01", tipo: "Umidade Relativa" });

    // Quando
    const unixtime = await enviar("UR-01", 120);

    // Então
    const gravada = await medida(sensor, unixtime);
    expect(Number(gravada.valor)).toBe(120);
    expect(gravada.valida).toBe(false);
  });

  it("Cenário 5: sensor em Kelvin com offset -273,15, bruto 300 vira 26,85 °C e é válido", async () => {
    // Dado
    const sensor = await cadastrarSensor(pool, {
      estacaoId: estacao,
      codigo: "TEMP-K",
      tipo: "Temperatura",
      fator_conversao: "1",
      offset: "-273.15",
    });

    // Quando
    const unixtime = await enviar("TEMP-K", 300);

    // Então
    const gravada = await medida(sensor, unixtime);
    expect(Number(gravada.valor_bruto)).toBe(300);
    expect(Number(gravada.valor)).toBe(26.85);
    expect(gravada.valida).toBe(true);
  });

  it("direção do vento: 360 é válida e 400 é inválida", async () => {
    // Dado
    const sensor = await cadastrarSensor(pool, { estacaoId: estacao, codigo: "DIR-01", tipo: "Direção do Vento" });

    // Quando
    const noLimite = await enviar("DIR-01", 360);
    const acima = await enviar("DIR-01", 400);

    // Então
    expect((await medida(sensor, noLimite)).valida).toBe(true);
    expect((await medida(sensor, acima)).valida).toBe(false);
  });

  it("grandeza nova cadastrada pelo Administrador é validada sem mudar o código", async () => {
    // Dado
    await cadastrarGrandeza(pool, { nome: "Nebulosidade", unidade: "oitavos", faixa_min: "0", faixa_max: "8" });
    const sensor = await cadastrarSensor(pool, { estacaoId: estacao, codigo: "NEB-01", tipo: "Nebulosidade" });

    // Quando
    const noLimite = await enviar("NEB-01", 8);
    const acima = await enviar("NEB-01", 9);

    // Então
    expect((await medida(sensor, noLimite)).valida).toBe(true);
    expect((await medida(sensor, acima)).valida).toBe(false);
  });

  it("Cenário 7: a faixa alterada no catálogo vale só para as leituras seguintes", async () => {
    // Dado: umidade de 0 a 100 e uma leitura de 80 já gravada como válida
    const sensor = await cadastrarSensor(pool, { estacaoId: estacao, codigo: "UR-01", tipo: "Umidade Relativa" });
    const antes = await enviar("UR-01", 80);

    // Quando: o Administrador baixa o máximo para 75 e chega outra leitura de 80
    await cadastrarGrandeza(pool, { nome: "Umidade Relativa", unidade: "%", faixa_min: "0", faixa_max: "75" });
    const depois = await enviar("UR-01", 80);

    // Então: a medida antiga não é reavaliada; a nova usa a faixa nova
    expect((await medida(sensor, antes)).valida).toBe(true);
    expect((await medida(sensor, depois)).valida).toBe(false);
  });
});
