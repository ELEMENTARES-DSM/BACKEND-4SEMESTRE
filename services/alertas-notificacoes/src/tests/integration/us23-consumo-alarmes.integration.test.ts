import { randomUUID } from "node:crypto";
import amqp, { Channel, ChannelModel } from "amqplib";
import { pool } from "../../config/db";
import {
  ConsumidorRabbitMqAlarmes,
  EXCHANGE_ALARME_DISPARADO,
  FILA_NOTIFICACAO_ALARMES,
  FILA_NOTIFICACAO_DLQ,
  declararTopologiaAlarmes,
} from "../../events/consumers/rabbitmq-alarme.consumer";
import { findByAlarme } from "../../repositories/notificacao.repository";
import logger from "../../utils/logger";
import { cadastrarUsuario, prepararSchemaNotificacoes } from "./helpers/banco-notificacoes";

// US-23 (TASK 23.02) com PostgreSQL e RabbitMQ reais. Execute com
// ALERTAS_TEST_DATABASE_URL e RABBITMQ_TEST_URL apontando para instâncias de teste.
const databaseUrl = process.env.ALERTAS_TEST_DATABASE_URL;
const rabbitUrl = process.env.RABBITMQ_TEST_URL;
const integration = databaseUrl && rabbitUrl ? describe : describe.skip;

async function esperar(condicao: () => Promise<boolean>, descricao: string, limiteMs = 10000) {
  const inicio = Date.now();
  while (!(await condicao())) {
    if (Date.now() - inicio > limiteMs) throw new Error(`Tempo esgotado esperando ${descricao}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

integration("US-23 - consumo de alarme.disparado (PostgreSQL e RabbitMQ)", () => {
  const schema = `alertas_us23c_${randomUUID().replaceAll("-", "")}`;
  let conexao: ChannelModel;
  let canal: Channel;
  let consumidor: ConsumidorRabbitMqAlarmes;
  const SJC = "São José dos Campos";

  const evento = (municipio = SJC) => ({
    alarme_id: randomUUID(),
    regra_id: randomUUID(),
    medida_id: randomUUID(),
    sensor_id: randomUUID(),
    estacao_id: randomUUID(),
    municipio,
    valor: "52.300000",
    operador: ">=",
    limite: "50.00",
    severidade: "CRITICO",
    lido_em: "2026-10-24T13:00:00.000Z",
    criado_em: "2026-10-24T13:00:01.412Z",
  });

  // Publica como o servico-validacao publica (exchange alarme.disparado).
  const publicar = (corpo: unknown, messageId: string) =>
    canal.publish(EXCHANGE_ALARME_DISPARADO, "", Buffer.from(typeof corpo === "string" ? corpo : JSON.stringify(corpo)), {
      persistent: true,
      contentType: "application/json",
      messageId,
    });

  const naFila = async (fila: string) => (await canal.checkQueue(fila)).messageCount;

  beforeAll(async () => {
    jest.spyOn(logger, "info").mockImplementation(() => undefined);
    jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    await prepararSchemaNotificacoes(pool, schema);
    conexao = await amqp.connect(rabbitUrl as string);
    canal = await conexao.createChannel();
    await declararTopologiaAlarmes(canal);
    await canal.purgeQueue(FILA_NOTIFICACAO_ALARMES);
    await canal.purgeQueue(FILA_NOTIFICACAO_DLQ);

    consumidor = new ConsumidorRabbitMqAlarmes({ url: rabbitUrl as string, reconectarMs: 200 });
    await consumidor.iniciar();
    await esperar(async () => consumidor.estaSaudavel(), "consumidor conectado");
  });

  afterAll(async () => {
    try {
      await consumidor.encerrar();
      await canal.purgeQueue(FILA_NOTIFICACAO_ALARMES);
      await canal.purgeQueue(FILA_NOTIFICACAO_DLQ);
      await conexao.close();
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await pool.end();
      jest.restoreAllMocks();
    }
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE notificacoes, usuarios");
    await canal.purgeQueue(FILA_NOTIFICACAO_DLQ);
  });

  it("cenários 1, 2 e 3: só os gestores ativos do município da estação ficam com aviso", async () => {
    const ana = await cadastrarUsuario(pool, { nome: "Ana Gestora", papel: "GESTOR_PUBLICO", municipio: SJC });
    const bia = await cadastrarUsuario(pool, { nome: "Bia Gestora", papel: "GESTOR_PUBLICO", municipio: SJC });
    await cadastrarUsuario(pool, { nome: "Caio Inativo", papel: "GESTOR_PUBLICO", municipio: SJC, ativo: false });
    await cadastrarUsuario(pool, { nome: "Davi Paulista", papel: "GESTOR_PUBLICO", municipio: "São Paulo" });
    await cadastrarUsuario(pool, { nome: "Eva Admin", papel: "ADMINISTRADOR" });
    const ev = evento();

    publicar(ev, ev.alarme_id);
    await esperar(async () => (await findByAlarme(ev.alarme_id)).length === 2, "dois avisos");

    const avisos = await findByAlarme(ev.alarme_id);
    expect(avisos.map((a) => a.destinatario_id).sort()).toEqual([ana, bia].sort());
    expect(avisos.every((a) => a.canal === "email")).toBe(true);
    await esperar(async () => (await naFila(FILA_NOTIFICACAO_ALARMES)) === 0, "evento confirmado");
  });

  it("cenário 5: o mesmo evento entregue de novo não cria aviso novo", async () => {
    await cadastrarUsuario(pool, { nome: "Ana Gestora", papel: "GESTOR_PUBLICO", municipio: SJC });
    const ev = evento();

    publicar(ev, ev.alarme_id);
    await esperar(async () => (await findByAlarme(ev.alarme_id)).length === 1, "primeiro aviso");
    publicar(ev, ev.alarme_id);
    const outro = evento();
    publicar(outro, outro.alarme_id);
    await esperar(async () => (await findByAlarme(outro.alarme_id)).length === 1, "evento seguinte processado");

    expect(await findByAlarme(ev.alarme_id)).toHaveLength(1);
  });

  it("evento malformado vai para a notificacao.dlq sem criar aviso", async () => {
    await cadastrarUsuario(pool, { nome: "Ana Gestora", papel: "GESTOR_PUBLICO", municipio: SJC });

    publicar({ alarme_id: "não é uuid", municipio: SJC }, "malformado");

    await esperar(async () => (await naFila(FILA_NOTIFICACAO_DLQ)) === 1, "evento na DLQ");
    const { rows } = await pool.query("SELECT count(*)::int AS total FROM notificacoes");
    expect(rows[0].total).toBe(0);
  });

  it("alarme sem gestor no município é confirmado sem aviso", async () => {
    const ev = evento("Jacareí");

    publicar(ev, ev.alarme_id);

    await esperar(async () => (await naFila(FILA_NOTIFICACAO_ALARMES)) === 0, "evento confirmado");
    expect(await findByAlarme(ev.alarme_id)).toEqual([]);
    expect(await naFila(FILA_NOTIFICACAO_DLQ)).toBe(0);
  });
});
