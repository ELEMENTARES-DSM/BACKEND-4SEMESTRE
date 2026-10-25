import { randomUUID } from "node:crypto";
import amqp, { Channel, ChannelModel } from "amqplib";
import { pool } from "../../config/db";
import {
  ConsumidorRabbitMqAlarmes,
  EXCHANGE_ALARME_DISPARADO,
  FILA_NOTIFICACAO_ALARMES,
  FILA_NOTIFICACAO_DLQ,
  ProcessadorEventoAlarme,
  declararTopologiaAlarmes,
  processarEventoAlarme,
} from "../../events/consumers/rabbitmq-alarme.consumer";
import { registrarAvisos } from "../../services/avisar-gestores.service";
import { enviarAvisos } from "../../services/enviar-aviso.service";
import { findByAlarme } from "../../repositories/notificacao.repository";
import logger from "../../utils/logger";
import { cadastrarUsuario, prepararSchemaNotificacoes } from "./helpers/banco-notificacoes";

// US-23 (TASK 23.03) com PostgreSQL, RabbitMQ e caixa de e-mail (Mailpit) reais.
// Execute com ALERTAS_TEST_DATABASE_URL, RABBITMQ_TEST_URL, SMTP_TEST_HOST,
// SMTP_TEST_PORT e MAILPIT_TEST_URL (API HTTP do Mailpit).
const databaseUrl = process.env.ALERTAS_TEST_DATABASE_URL;
const rabbitUrl = process.env.RABBITMQ_TEST_URL;
const mailpitUrl = process.env.MAILPIT_TEST_URL;
const integration = databaseUrl && rabbitUrl && mailpitUrl && process.env.SMTP_TEST_HOST ? describe : describe.skip;

async function esperar(condicao: () => Promise<boolean>, descricao: string, limiteMs = 15000) {
  const inicio = Date.now();
  while (!(await condicao())) {
    if (Date.now() - inicio > limiteMs) throw new Error(`Tempo esgotado esperando ${descricao}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

interface MensagemMailpit {
  Subject: string;
  To: { Address: string }[];
}

const caixa = async (): Promise<MensagemMailpit[]> =>
  ((await (await fetch(`${mailpitUrl}/api/v1/messages`)).json()) as { messages: MensagemMailpit[] }).messages;

integration("US-23 - envio do aviso por e-mail (PostgreSQL, RabbitMQ e Mailpit)", () => {
  const schema = `alertas_us23e_${randomUUID().replaceAll("-", "")}`;
  const SJC = "São José dos Campos";
  let conexao: ChannelModel;
  let canal: Channel;
  let consumidor: ConsumidorRabbitMqAlarmes | undefined;

  const evento = () => ({
    alarme_id: randomUUID(),
    regra_id: randomUUID(),
    medida_id: randomUUID(),
    sensor_id: randomUUID(),
    estacao_id: randomUUID(),
    municipio: SJC,
    valor: "52.300000",
    operador: ">=",
    limite: "50.00",
    severidade: "CRITICO",
    lido_em: "2026-10-24T13:00:00.000Z",
    criado_em: "2026-10-24T13:00:01.412Z",
  });

  const publicar = (ev: ReturnType<typeof evento>) =>
    canal.publish(EXCHANGE_ALARME_DISPARADO, "", Buffer.from(JSON.stringify(ev)), { persistent: true, messageId: ev.alarme_id });

  const iniciar = async (processarEvento?: ProcessadorEventoAlarme) => {
    consumidor = new ConsumidorRabbitMqAlarmes({ url: rabbitUrl as string, reconectarMs: 200, processarEvento });
    await consumidor.iniciar();
    await esperar(async () => consumidor?.estaSaudavel() === true, "consumidor conectado");
  };

  beforeAll(async () => {
    jest.spyOn(logger, "info").mockImplementation(() => undefined);
    jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    process.env.SMTP_HOST = process.env.SMTP_TEST_HOST;
    process.env.SMTP_PORT = process.env.SMTP_TEST_PORT;
    await prepararSchemaNotificacoes(pool, schema);
    conexao = await amqp.connect(rabbitUrl as string);
    canal = await conexao.createChannel();
    await declararTopologiaAlarmes(canal);
  });

  afterAll(async () => {
    try {
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
    await canal.purgeQueue(FILA_NOTIFICACAO_ALARMES);
    await canal.purgeQueue(FILA_NOTIFICACAO_DLQ);
    await fetch(`${mailpitUrl}/api/v1/messages`, { method: "DELETE" });
  });

  afterEach(async () => {
    await consumidor?.encerrar();
    consumidor = undefined;
  });

  it("cenários 1 e 7: os dois gestores de São José dos Campos recebem o e-mail e o envio fica registrado", async () => {
    await cadastrarUsuario(pool, { nome: "Ana Gestora", papel: "GESTOR_PUBLICO", municipio: SJC });
    await cadastrarUsuario(pool, { nome: "Bia Gestora", papel: "GESTOR_PUBLICO", municipio: SJC });
    await cadastrarUsuario(pool, { nome: "Davi Paulista", papel: "GESTOR_PUBLICO", municipio: "São Paulo" });
    await iniciar(processarEventoAlarme);
    const ev = evento();

    publicar(ev);
    await esperar(async () => (await caixa()).length === 2, "dois e-mails na caixa");

    const emails = await caixa();
    expect(emails.map((m) => m.To[0].Address).sort()).toEqual(["ana.gestora@exemplo.com", "bia.gestora@exemplo.com"]);
    expect(emails.every((m) => m.Subject.startsWith("[Pulso Urbano] Alarme Crítico"))).toBe(true);
    await esperar(async () => (await findByAlarme(ev.alarme_id)).every((a) => a.situacao === "enviado"), "avisos enviados");
    expect((await findByAlarme(ev.alarme_id)).map((a) => a.tentativas)).toEqual([1, 1]);
  });

  it("cenário 5: o evento entregue de novo não manda outro e-mail", async () => {
    await cadastrarUsuario(pool, { nome: "Ana Gestora", papel: "GESTOR_PUBLICO", municipio: SJC });
    await iniciar(processarEventoAlarme);
    const ev = evento();

    publicar(ev);
    await esperar(async () => (await caixa()).length === 1, "primeiro e-mail");
    publicar(ev);
    const outro = evento();
    publicar(outro);
    await esperar(async () => (await caixa()).length === 2, "e-mail do evento seguinte");

    expect((await caixa()).length).toBe(2);
  });

  it("cenário 4: com o SMTP fora do ar, 3 tentativas registradas e o evento na notificacao.dlq", async () => {
    await cadastrarUsuario(pool, { nome: "Ana Gestora", papel: "GESTOR_PUBLICO", municipio: SJC });
    // Mesmo fluxo do serviço, sem as esperas entre tentativas.
    await iniciar(async (ev) => {
      const avisos = await registrarAvisos(ev);
      const resultado = await enviarAvisos(ev, avisos, {
        enviarEmail: async () => {
          throw new Error("connect ECONNREFUSED 127.0.0.1:1");
        },
        esperar: async () => undefined,
      });
      return { enviarParaDlq: resultado.falharam > 0 };
    });
    const ev = evento();

    publicar(ev);
    await esperar(async () => (await canal.checkQueue(FILA_NOTIFICACAO_DLQ)).messageCount === 1, "evento na DLQ");

    const [aviso] = await findByAlarme(ev.alarme_id);
    expect(aviso).toEqual(expect.objectContaining({ situacao: "falhou", tentativas: 3, ultimo_erro: "connect ECONNREFUSED 127.0.0.1:1" }));
  });
});
