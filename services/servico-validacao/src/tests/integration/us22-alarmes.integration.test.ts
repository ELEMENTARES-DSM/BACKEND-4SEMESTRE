import { randomUUID } from "node:crypto";
import { describe, it, expect, jest, beforeAll, afterAll, beforeEach } from "@jest/globals";
import { Channel, ChannelModel } from "amqplib";
import { pool } from "../../config/db";
import { ConsumidorRabbitMqTelemetria } from "../../events/consumers/rabbitmq-telemetria.consumer";
import logger from "../../utils/logger";
import {
  cadastrarEstacao,
  cadastrarRegra,
  cadastrarSensor,
  prepararSchemaValidacao,
} from "./helpers/banco-validacao";
import { conectarAdmin, esperar, limparFilas, publicarEvento } from "./helpers/rabbitmq-validacao";

// US-22 de ponta a ponta com PostgreSQL e RabbitMQ reais. Execute com
// VALIDACAO_TEST_DATABASE_URL e RABBITMQ_TEST_URL apontando para instâncias de teste.
const databaseUrl = process.env.VALIDACAO_TEST_DATABASE_URL;
const rabbitUrl = process.env.RABBITMQ_TEST_URL;
const integration = databaseUrl && rabbitUrl ? describe : describe.skip;

integration("US-22 - avaliar regras e registrar alarme (PostgreSQL e RabbitMQ)", () => {
  const schema = `validacao_us22_${randomUUID().replaceAll("-", "")}`;
  let admin: { connection: ChannelModel; channel: Channel };
  let consumidor: ConsumidorRabbitMqTelemetria;
  let estacao: string;
  let pm25: string;
  let umidade: string;

  const contarMedidas = async () => {
    const { rows } = await pool.query<{ total: string }>("SELECT count(*) AS total FROM medidas");
    return Number(rows[0].total);
  };

  const alarmes = async () => {
    const { rows } = await pool.query(
      `SELECT regra_id, medida_id, sensor_id, estacao_id, municipio, valor, operador, limite,
              severidade, situacao, lido_em, criado_em, normalizado_em
       FROM alarmes
       ORDER BY lido_em, criado_em`,
    );
    return rows;
  };

  const evento = (leituras: Array<[string, number]>, unixtime = 1792400000, estacaoUuid = estacao) => ({
    staging_id: randomUUID(),
    estacao_uuid: estacaoUuid,
    unixtime,
    leituras: leituras.map(([sensor, valor]) => ({ sensor, valor })),
  });

  // Publica e espera a medida ser gravada (a avaliação está na mesma transação).
  const processar = async (ev: ReturnType<typeof evento>, medidasDepois: number) => {
    publicarEvento(admin.channel, ev);
    await esperar(async () => (await contarMedidas()) === medidasDepois, `${medidasDepois} medidas`);
  };

  beforeAll(async () => {
    jest.spyOn(logger, "info").mockImplementation(() => undefined);
    jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    await prepararSchemaValidacao(pool, schema);
    admin = await conectarAdmin(rabbitUrl as string);
    await limparFilas(admin.channel);

    consumidor = new ConsumidorRabbitMqTelemetria({ url: rabbitUrl as string, reconectarMs: 200 });
    await consumidor.iniciar();
    await esperar(async () => consumidor.estaSaudavel(), "consumidor conectado");
  });

  afterAll(async () => {
    try {
      await consumidor.encerrar();
      await limparFilas(admin.channel);
      await admin.connection.close();
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await pool.end();
      jest.restoreAllMocks();
    }
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE medidas, sensores, estacoes CASCADE");
    await limparFilas(admin.channel);
    estacao = randomUUID();
    await cadastrarEstacao(pool, estacao, "São José dos Campos");
    pm25 = await cadastrarSensor(pool, { estacaoId: estacao, codigo: "PM25-01", tipo: "PM2.5" });
    umidade = await cadastrarSensor(pool, { estacaoId: estacao, codigo: "UR-01", tipo: "Umidade Relativa" });
  });

  it("cenário 1: PM2.5 52,3 com regra >= 50,00 CRITICO grava o alarme com os dados da regra, do sensor e da leitura", async () => {
    const regra = await cadastrarRegra(pool, { sensorId: pm25, operador: ">=", limite: "50.00" });

    await processar(evento([["PM25-01", 52.3]], 1792400000), 1);

    const [alarme] = await alarmes();
    expect(await alarmes()).toHaveLength(1);
    expect(alarme).toEqual(
      expect.objectContaining({
        regra_id: regra,
        sensor_id: pm25,
        estacao_id: estacao,
        municipio: "São José dos Campos",
        valor: "52.300000",
        operador: ">=",
        limite: "50.00",
        severidade: "CRITICO",
        situacao: "aberto",
        normalizado_em: null,
      }),
    );
    expect(new Date(alarme.lido_em).toISOString()).toBe(new Date(1792400000 * 1000).toISOString());
  });

  it("cenário 2: valor exatamente no limite não viola '>' e viola '>='", async () => {
    await cadastrarRegra(pool, { sensorId: pm25, operador: ">", limite: "50" });
    await cadastrarRegra(pool, { sensorId: umidade, operador: ">=", limite: "50" });

    await processar(evento([["PM25-01", 50], ["UR-01", 50]]), 2);

    expect((await alarmes()).map((a) => [a.sensor_id, a.operador])).toEqual([[umidade, ">="]]);
  });

  it("cenário 3: regra inativa não dispara alarme", async () => {
    await cadastrarRegra(pool, { sensorId: pm25, operador: ">=", limite: "50.00", ativa: false });

    await processar(evento([["PM25-01", 80]]), 1);

    expect(await alarmes()).toEqual([]);
  });

  it("cenário 4: sensor inativo não grava medida nem alarme, e estação inativa grava a medida sem alarme", async () => {
    const inativo = await cadastrarSensor(pool, {
      estacaoId: estacao,
      codigo: "PM10-01",
      tipo: "PM10",
      status: "Inativo",
    });
    await cadastrarRegra(pool, { sensorId: inativo, operador: ">=", limite: "50.00" });
    const estacaoInativa = randomUUID();
    await cadastrarEstacao(pool, estacaoInativa, "São José dos Campos", "Inativa");
    const sensorDaInativa = await cadastrarSensor(pool, { estacaoId: estacaoInativa, codigo: "PM25-01", tipo: "PM2.5" });
    await cadastrarRegra(pool, { sensorId: sensorDaInativa, operador: ">=", limite: "50.00" });

    await processar(evento([["PM10-01", 90], ["UR-01", 40]]), 1);
    await processar(evento([["PM25-01", 90]], 1792400000, estacaoInativa), 2);

    expect(await alarmes()).toEqual([]);
  });

  it("cenário 5: umidade 120,0 gravada como inválida não dispara a regra >= 90", async () => {
    await cadastrarRegra(pool, { sensorId: umidade, operador: ">=", limite: "90" });

    await processar(evento([["UR-01", 120.0]]), 1);

    const { rows } = await pool.query("SELECT valida FROM medidas");
    expect(rows).toEqual([{ valida: false }]);
    expect(await alarmes()).toEqual([]);
  });

  it("cenário 6: duas regras violadas pela mesma leitura gravam dois alarmes", async () => {
    const alerta = await cadastrarRegra(pool, { sensorId: pm25, operador: ">=", limite: "35", severidade: "ALERTA" });
    const critico = await cadastrarRegra(pool, { sensorId: pm25, operador: ">=", limite: "50", severidade: "CRITICO" });

    await processar(evento([["PM25-01", 52.3]]), 1);

    const gravados = await alarmes();
    expect(gravados.map((a) => a.regra_id).sort()).toEqual([alerta, critico].sort());
    expect(new Set(gravados.map((a) => a.medida_id)).size).toBe(1);
  });

  it("cenário 7: violação contínua não grava alarme novo enquanto o alarme da regra estiver aberto", async () => {
    await cadastrarRegra(pool, { sensorId: pm25, operador: ">=", limite: "50" });

    await processar(evento([["PM25-01", 52.3]], 1792400000), 1);
    await processar(evento([["PM25-01", 60]], 1792400300), 2);
    await processar(evento([["PM25-01", 75]], 1792400600), 3);

    expect(await alarmes()).toHaveLength(1);
  });

  it("cenário 8: valor normal normaliza o alarme e uma nova violação abre outro", async () => {
    await cadastrarRegra(pool, { sensorId: pm25, operador: ">=", limite: "50" });

    await processar(evento([["PM25-01", 52.3]], 1792400000), 1);
    await processar(evento([["PM25-01", 20]], 1792400300), 2);

    const [normalizado] = await alarmes();
    expect(normalizado.situacao).toBe("normalizado");
    expect(normalizado.normalizado_em).not.toBeNull();

    await processar(evento([["PM25-01", 55]], 1792400600), 3);

    expect((await alarmes()).map((a) => a.situacao)).toEqual(["normalizado", "aberto"]);
  });

  it("cenário 9: evento entregue de novo não grava alarme duplicado", async () => {
    await cadastrarRegra(pool, { sensorId: pm25, operador: ">=", limite: "50" });
    const original = evento([["PM25-01", 52.3]], 1792400000);

    await processar(original, 1);
    publicarEvento(admin.channel, original);
    await processar(evento([["UR-01", 40]], 1792400300), 2);

    expect(await alarmes()).toHaveLength(1);
  });

  it("cenário 10: o alarme herda o município da estação do sensor", async () => {
    const outra = randomUUID();
    await cadastrarEstacao(pool, outra, "Jacareí");
    const sensorJacarei = await cadastrarSensor(pool, { estacaoId: outra, codigo: "PM25-01", tipo: "PM2.5" });
    await cadastrarRegra(pool, { sensorId: sensorJacarei, operador: ">=", limite: "50" });
    await cadastrarRegra(pool, { sensorId: pm25, operador: ">=", limite: "50" });

    await processar(evento([["PM25-01", 52.3]], 1792400000), 1);
    await processar(evento([["PM25-01", 52.3]], 1792400000, outra), 2);

    expect((await alarmes()).map((a) => a.municipio).sort()).toEqual(["Jacareí", "São José dos Campos"]);
  });

  it("compara o valor já calibrado: bruto 47,6 com fator 1,1 vira 52,36 e viola >= 50", async () => {
    const calibrado = await cadastrarSensor(pool, {
      estacaoId: estacao,
      codigo: "PM10-01",
      tipo: "PM10",
      fator: "1.1",
    });
    await cadastrarRegra(pool, { sensorId: calibrado, operador: ">=", limite: "50" });

    await processar(evento([["PM10-01", 47.6]]), 1);

    expect((await alarmes()).map((a) => a.valor)).toEqual(["52.360000"]);
  });

  it("leitura normal mais antiga que a do alarme aberto não o normaliza", async () => {
    await cadastrarRegra(pool, { sensorId: pm25, operador: ">=", limite: "50" });

    await processar(evento([["PM25-01", 52.3]], 1792400600), 1);
    await processar(evento([["PM25-01", 20]], 1792400000), 2);

    expect((await alarmes()).map((a) => a.situacao)).toEqual(["aberto"]);
  });

  it("alarme aberto de regra inativada é normalizado na próxima leitura do sensor", async () => {
    const regra = await cadastrarRegra(pool, { sensorId: pm25, operador: ">=", limite: "50" });

    await processar(evento([["PM25-01", 52.3]], 1792400000), 1);
    await pool.query("UPDATE regras_alerta SET esta_ativo = FALSE WHERE id = $1", [regra]);
    await processar(evento([["PM25-01", 70]], 1792400300), 2);

    expect((await alarmes()).map((a) => a.situacao)).toEqual(["normalizado"]);
  });
});
