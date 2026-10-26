import { randomUUID } from "node:crypto";
import amqp, { Channel, ConfirmChannel } from "amqplib";
import { pool } from "../../../config/db";
import {
  EXCHANGE_TELEMETRIA_BRUTA,
  FILA_VALIDACAO_DLQ,
  FILA_VALIDACAO_TELEMETRIA,
  RabbitMqTelemetriaPublisher,
} from "../../../events/publishers/rabbitmq-telemetria.publisher";

const databaseUrl = process.env.STAGING_TEST_DATABASE_URL;
const rabbitUrl = process.env.RABBITMQ_TEST_URL;
const integration = databaseUrl && rabbitUrl ? describe : describe.skip;

interface StagingRow {
  id: string;
  estacao_uuid: string;
  unixtime: string;
  payload: { leituras: Array<{ sensor: string; valor: number }> };
  status: string;
  processado_em: Date | null;
  tentativas: number;
  ultimo_erro: string | null;
}

integration("recuperação do publicador RabbitMQ", () => {
  const schema = `publisher_test_${randomUUID().replaceAll("-", "")}`;
  const publicadores: RabbitMqTelemetriaPublisher[] = [];

  const inserirMensagem = async (
    criadoEm: Date,
    status: "recebida" | "pendente" = "pendente",
  ): Promise<string> => {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO staging_telemetria (
         id, estacao_uuid, unixtime, payload_bruto, payload, status, criado_em
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
      [
        id,
        randomUUID(),
        Math.floor(criadoEm.getTime() / 1000),
        "payload original",
        JSON.stringify({ leituras: [{ sensor: "temperatura", valor: 23.5 }] }),
        status,
        criadoEm,
      ],
    );
    return id;
  };

  const buscarMensagem = async (id: string): Promise<StagingRow> => {
    const { rows } = await pool.query<StagingRow>(
      "SELECT * FROM staging_telemetria WHERE id = $1",
      [id],
    );
    return rows[0];
  };

  const aguardar = async (
    predicado: () => Promise<boolean>,
    descricao: string,
    timeoutMs = 10000,
  ): Promise<void> => {
    const limite = Date.now() + timeoutMs;
    while (Date.now() < limite) {
      if (await predicado()) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Timeout aguardando ${descricao}`);
  };

  const conectarAdmin = async (): Promise<{ connection: amqp.ChannelModel; channel: Channel }> => {
    const connection = await amqp.connect(rabbitUrl as string);
    const channel = await connection.createChannel();
    return { connection, channel };
  };

  beforeAll(async () => {
    pool.options.connectionString = databaseUrl;
    pool.options.options = `-c search_path=${schema}`;
    await pool.query(`CREATE SCHEMA ${schema}`);
    // Usa a migration real para manter o teste alinhado ao schema do serviço.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const migration = require("../../../db/migrations/1791986171448_create-staging-telemetria.cjs");
    const comandos: string[] = [];
    migration.up({ sql: (sql: string) => comandos.push(sql) });
    for (const sql of comandos) await pool.query(sql);
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE staging_telemetria");
    const { connection, channel } = await conectarAdmin();
    await channel.assertExchange(EXCHANGE_TELEMETRIA_BRUTA, "fanout", { durable: true });
    await channel.assertExchange("validacao.dlx", "fanout", { durable: true });
    await channel.assertQueue(FILA_VALIDACAO_TELEMETRIA, {
      durable: true,
      arguments: {
        "x-queue-type": "quorum",
        "x-delivery-limit": 3,
        "x-dead-letter-exchange": "validacao.dlx",
      },
    });
    await channel.bindQueue(FILA_VALIDACAO_TELEMETRIA, EXCHANGE_TELEMETRIA_BRUTA, "");
    await channel.assertQueue(FILA_VALIDACAO_DLQ, { durable: true });
    await channel.bindQueue(FILA_VALIDACAO_DLQ, "validacao.dlx", "");
    await channel.purgeQueue(FILA_VALIDACAO_TELEMETRIA);
    await channel.close();
    await connection.close();
  });

  afterEach(async () => {
    await Promise.all(publicadores.splice(0).map((publicador) => publicador.encerrar()));
  });

  afterAll(async () => {
    try {
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await pool.end();
    }
  });

  it("recupera 50 mensagens na ordem de recebimento, mesmo com duas instâncias", async () => {
    const inicio = Date.now() - 60000;
    const idsEsperados: string[] = [];
    for (let indice = 0; indice < 50; indice += 1) {
      idsEsperados.push(await inserirMensagem(new Date(inicio + indice * 1000)));
    }

    const primeiraInstancia = new RabbitMqTelemetriaPublisher({
      url: rabbitUrl as string,
      intervaloRecuperacaoMs: 10000,
    });
    const segundaInstancia = new RabbitMqTelemetriaPublisher({
      url: rabbitUrl as string,
      intervaloRecuperacaoMs: 10000,
    });
    publicadores.push(primeiraInstancia, segundaInstancia);
    await Promise.all([primeiraInstancia.iniciar(), segundaInstancia.iniciar()]);

    await aguardar(async () => {
      const { rows } = await pool.query<{ total: string }>(
        "SELECT count(*) AS total FROM staging_telemetria WHERE status = 'publicada'",
      );
      return Number(rows[0].total) === 50;
    }, "as 50 mensagens publicadas");

    const reader = await amqp.connect(rabbitUrl as string);
    const channel = await reader.createChannel();
    const idsRecebidos: string[] = [];
    for (let indice = 0; indice < 50; indice += 1) {
      const mensagem = await channel.get(FILA_VALIDACAO_TELEMETRIA, { noAck: true });
      expect(mensagem).not.toBe(false);
      if (!mensagem) throw new Error("Fila sem a mensagem confirmada esperada");
      expect(mensagem.properties.deliveryMode).toBe(2);
      const evento = JSON.parse(mensagem.content.toString()) as { staging_id: string };
      idsRecebidos.push(evento.staging_id);
    }
    expect(idsRecebidos).toEqual(idsEsperados);

    const { rows } = await pool.query<StagingRow>(
      "SELECT * FROM staging_telemetria ORDER BY criado_em ASC, id ASC",
    );
    expect(rows).toHaveLength(50);
    expect(rows.every((row) => row.status === "publicada" && row.processado_em !== null)).toBe(true);
    expect(rows.every((row) => row.ultimo_erro === null && row.tentativas === 0)).toBe(true);
    await channel.close();
    await reader.close();
  });

  it("recupera mensagens persistidas após falha inicial de conexão e reconexão", async () => {
    const id = await inserirMensagem(new Date(), "recebida");
    let falharPrimeiraConexao = true;
    const conectarComFalhaInicial: (url: string) => Promise<amqp.ChannelModel> = async (url) => {
      if (falharPrimeiraConexao) {
        falharPrimeiraConexao = false;
        throw new Error("indisponibilidade simulada no primeiro connect");
      }
      return amqp.connect(url);
    };
    const publicador = new RabbitMqTelemetriaPublisher({
      url: rabbitUrl as string,
      conectar: conectarComFalhaInicial,
      reconectarMs: 50,
      intervaloRecuperacaoMs: 50,
    });
    publicadores.push(publicador);

    await publicador.iniciar();
    const pendente = await buscarMensagem(id);
    expect(pendente.status).toBe("pendente");
    expect(pendente.tentativas).toBe(1);
    expect(pendente.ultimo_erro).toContain("indisponibilidade simulada");

    await aguardar(async () => (await buscarMensagem(id)).status === "publicada", "a recuperação após reconexão");
    const publicada = await buscarMensagem(id);
    expect(publicada.processado_em).not.toBeNull();
    expect(publicada.ultimo_erro).toBeNull();
  });

  it("varre o staging periodicamente sem depender de uma notificação em memória", async () => {
    const publicador = new RabbitMqTelemetriaPublisher({
      url: rabbitUrl as string,
      intervaloRecuperacaoMs: 75,
    });
    publicadores.push(publicador);
    await publicador.iniciar();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const id = await inserirMensagem(new Date(), "pendente");
    await aguardar(async () => (await buscarMensagem(id)).status === "publicada", "o scanner periódico");
    expect((await buscarMensagem(id)).processado_em).not.toBeNull();
  });

  it("recria fila e vínculo ausentes antes de recuperar mensagens", async () => {
    const { connection, channel } = await conectarAdmin();
    await channel.deleteQueue(FILA_VALIDACAO_TELEMETRIA);
    await channel.deleteQueue(FILA_VALIDACAO_DLQ);
    await channel.close();
    await connection.close();

    const id = await inserirMensagem(new Date(), "pendente");
    const publicador = new RabbitMqTelemetriaPublisher({
      url: rabbitUrl as string,
      intervaloRecuperacaoMs: 10000,
    });
    publicadores.push(publicador);
    await publicador.iniciar();

    await aguardar(async () => (await buscarMensagem(id)).status === "publicada", "a publicação após declarar a topologia");
    const { connection: adminConnection, channel: adminChannel } = await conectarAdmin();
    await expect(adminChannel.checkQueue(FILA_VALIDACAO_TELEMETRIA)).resolves.toMatchObject({ queue: FILA_VALIDACAO_TELEMETRIA });
    await expect(adminChannel.checkQueue(FILA_VALIDACAO_DLQ)).resolves.toMatchObject({ queue: FILA_VALIDACAO_DLQ });
    await adminChannel.close();
    await adminConnection.close();
  });

  it("rejeita a confirmação positiva quando mandatory devolve mensagem sem rota", async () => {
    const publicador = new RabbitMqTelemetriaPublisher({
      url: rabbitUrl as string,
      intervaloRecuperacaoMs: 10000,
    });
    publicadores.push(publicador);
    await publicador.iniciar();

    const connection = await amqp.connect(rabbitUrl as string);
    const channel = await connection.createConfirmChannel();
    await channel.unbindQueue(FILA_VALIDACAO_TELEMETRIA, EXCHANGE_TELEMETRIA_BRUTA, "");
    const publicarConfirmado = (
      publicador as unknown as {
        publicarConfirmado: (confirmChannel: ConfirmChannel, evento: unknown) => Promise<void>;
      }
    ).publicarConfirmado.bind(publicador);

    await expect(publicarConfirmado(channel, {
      staging_id: randomUUID(),
      unixtime: Math.floor(Date.now() / 1000),
    })).rejects.toThrow("NO_ROUTE");
    await channel.close();
    await connection.close();
  });
});
