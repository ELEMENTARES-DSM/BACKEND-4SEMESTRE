import { randomUUID } from "node:crypto";
import amqp, { Channel } from "amqplib";
import jwt from "jsonwebtoken";
import mqtt from "mqtt";
import request from "supertest";
import app from "../../app";
import { Pool } from "pg";
import { createClient } from "redis";
import { pool } from "../../config/db";
import { ClienteValkey, encerrarValkey, valkey } from "../../config/valkey";
import { ConsumidorMqttTelemetria } from "../../events/consumers/mqtt-telemetria.consumer";
import {
  EXCHANGE_TELEMETRIA_BRUTA,
  RabbitMqTelemetriaPublisher,
} from "../../events/publishers/rabbitmq-telemetria.publisher";
import {
  chaveMensagem,
  LISTA_PENDENTES,
  LISTA_RECEBIDAS,
} from "../../repositories/staging-valkey.repository";
import {
  encerrarVerificacao,
  iniciarVerificacao,
  receberMensagem,
} from "../../services/processar-mensagem.service";
import { configurarPublisherStaging, encerrarPublisherStaging } from "../../services/staging-publisher.service";
import { logger } from "../../utils/logger";
import { cadastrarEstacao, criarTabelaEstacoes } from "./helpers/estacoes";
import { ProxyTcp } from "./helpers/proxy-tcp";
import { esperar, esperarValkeyPronto } from "./helpers/valkey";

// US-40 com Mosquitto, Valkey, PostgreSQL e RabbitMQ de teste em container. O
// serviço fala com o Valkey e com o PostgreSQL por proxies TCP: derrubar o
// proxy simula o container parado, religar simula ele voltando.
const { STAGING_TEST_DATABASE_URL, VALKEY_TEST_URL, MQTT_TEST_URL, RABBITMQ_TEST_URL } = process.env;
const integration = STAGING_TEST_DATABASE_URL && VALKEY_TEST_URL && MQTT_TEST_URL && RABBITMQ_TEST_URL
  ? describe
  : describe.skip;

const BANCO_VALKEY = 4;
// O middleware lê o JWT_SECRET na hora de cada requisição.
const JWT_TESTE = "segredo-so-do-teste-de-metricas";
process.env.JWT_SECRET = JWT_TESTE;
const topicoDe = (uuid: string) => `pulso/estacoes/${uuid}/telemetria`;
const leitura = (timestamp: string, extras = "") =>
  `{"timestamp":"${timestamp}"${extras},"leituras":[{"sensor":"T-01","valor":25.4}]}`;

integration("US-40 · staging no Valkey com Mosquitto, Valkey e PostgreSQL reais", () => {
  const schema = `staging_valkey_test_${randomUUID().replaceAll("-", "")}`;
  let proxyValkey: ProxyTcp;
  let proxyBanco: ProxyTcp;
  let banco: Pool;
  let consumidor: ConsumidorMqttTelemetria;
  let estacao: mqtt.MqttClient;
  // Estado de cada mensagem no Valkey no instante em que o consumidor ia confirmar.
  const antesDoPuback = new Map<string, Record<string, string>>();
  const gravacoes: string[] = [];

  // Conferências direto no Valkey de teste, sem passar pelo proxy derrubado.
  let direto: ClienteValkey;
  // Fila só deste arquivo, ligada ao fanout telemetria.bruta.
  let admin: amqp.ChannelModel;
  let canal: Channel;
  let observada: string;
  const publicadas = new Map<string, { staging_id: string; estacao_uuid: string }>();

  const lerPublicadas = async (): Promise<void> => {
    let mensagem = await canal.get(observada, { noAck: true });
    while (mensagem) {
      const evento = JSON.parse(mensagem.content.toString());
      publicadas.set(evento.staging_id, evento);
      mensagem = await canal.get(observada, { noAck: true });
    }
  };

  const status = async (id: string) => direto.hGet(chaveMensagem(id), "status");

  const hashes = async (estacaoId: string) => {
    const ids = gravacoes.slice();
    const todos: Array<Record<string, string>> = await Promise.all(ids.map(async (id) => ({
      id,
      ...(await direto.hGetAll(chaveMensagem(id))),
    })));
    return todos.filter((h) => h.topico === topicoDe(estacaoId));
  };

  beforeAll(async () => {
    banco = new Pool({ connectionString: STAGING_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
    await banco.query(`CREATE SCHEMA ${schema}`);
    await criarTabelaEstacoes(banco);

    const destinoBanco = new URL(STAGING_TEST_DATABASE_URL as string);
    proxyBanco = new ProxyTcp(destinoBanco.hostname, Number(destinoBanco.port || 5432));
    const viaProxyBanco = new URL(STAGING_TEST_DATABASE_URL as string);
    viaProxyBanco.hostname = "127.0.0.1";
    viaProxyBanco.port = String(await proxyBanco.ligar());
    // O módulo db é carregado antes dos hooks: configurar o pool explicitamente.
    pool.options.connectionString = viaProxyBanco.toString();
    pool.options.options = `-c search_path=${schema}`;
    pool.options.connectionTimeoutMillis = 1000;

    const destinoValkey = new URL(VALKEY_TEST_URL as string);
    proxyValkey = new ProxyTcp(destinoValkey.hostname, Number(destinoValkey.port || 6379));
    const viaProxyValkey = new URL(VALKEY_TEST_URL as string);
    viaProxyValkey.hostname = "127.0.0.1";
    viaProxyValkey.port = String(await proxyValkey.ligar());
    viaProxyValkey.pathname = `/${BANCO_VALKEY}`;
    process.env.REDIS_URL = viaProxyValkey.toString();
    await esperarValkeyPronto();
    await valkey().flushDb();
    const urlDireta = new URL(VALKEY_TEST_URL as string);
    urlDireta.pathname = `/${BANCO_VALKEY}`;
    direto = createClient({ url: urlDireta.toString() });
    await direto.connect();

    admin = await amqp.connect(RABBITMQ_TEST_URL as string);
    canal = await admin.createChannel();
    await canal.assertExchange(EXCHANGE_TELEMETRIA_BRUTA, "fanout", { durable: true });
    observada = (await canal.assertQueue("", { exclusive: true })).queue;
    await canal.bindQueue(observada, EXCHANGE_TELEMETRIA_BRUTA, "");
    const publicador = new RabbitMqTelemetriaPublisher({ url: RABBITMQ_TEST_URL as string, intervaloRecuperacaoMs: 300 });
    configurarPublisherStaging(publicador);
    await publicador.iniciar();
    iniciarVerificacao(300);

    consumidor = new ConsumidorMqttTelemetria({
      config: { brokerUrl: MQTT_TEST_URL as string, qos: 1 },
      proximoPasso: async (mensagem) => {
        const id = await receberMensagem(mensagem);
        gravacoes.push(id);
        antesDoPuback.set(id, await valkey().hGetAll(chaveMensagem(id)));
      },
      reentregaMs: 500,
      // O clientId fixo do serviço derrubaria outra execução no mesmo broker de teste.
      clientId: `ingestao-dados-teste-${randomUUID()}`,
    });
    consumidor.iniciar();
    estacao = await mqtt.connectAsync(MQTT_TEST_URL as string, { clientId: `estacao-${randomUUID()}` });
  });

  afterAll(async () => {
    try {
      encerrarVerificacao();
      await consumidor.encerrar();
      await encerrarPublisherStaging();
      await canal.close();
      await admin.close();
      await new Promise<void>((resolve) => estacao.end(true, {}, () => resolve()));
      await direto.flushDb();
      await direto.disconnect();
      await encerrarValkey();
      await pool.end();
      await proxyValkey.derrubar();
      await proxyBanco.derrubar();
      await banco.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await banco.end();
    }
  });

  beforeEach(() => {
    jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    jest.spyOn(logger, "info").mockImplementation(() => undefined);
    jest.spyOn(logger, "error").mockImplementation(() => undefined);
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  // Publica até o consumidor gravar, para garantir que ele já assinou.
  async function publicarAteGravar(estacaoId: string, payload: string): Promise<void> {
    await esperar(async () => {
      if ((await hashes(estacaoId)).some((h) => h.conteudo === payload)) return true;
      await estacao.publishAsync(topicoDe(estacaoId), payload, { qos: 1 });
      await new Promise((resolve) => setTimeout(resolve, 200));
      return (await hashes(estacaoId)).some((h) => h.conteudo === payload);
    }, 20000);
  }

  describe("US-40 · Cenário 1 · gravação antes de tudo", () => {
    it("deve estar no Valkey como recebida, com o conteúdo como chegou, antes do PUBACK quando a leitura chega", async () => {
      // Dado (Arrange)
      const estacaoId = randomUUID();
      await cadastrarEstacao(banco, estacaoId);
      const payload = leitura("2026-10-20T12:00:00Z", ',"nivel_bateria":87');

      // Quando (Act)
      await publicarAteGravar(estacaoId, payload);

      // Então (Assert)
      const [gravada] = await hashes(estacaoId);
      expect(antesDoPuback.get(gravada.id)).toEqual({
        topico: topicoDe(estacaoId),
        conteudo: payload,
        recebidoEm: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
        status: "recebida",
      });
      await esperar(async () => (await status(gravada.id)) === "encaminhada");
      expect(await direto.lRange(LISTA_PENDENTES, 0, -1)).not.toContain(gravada.id);
      expect(await direto.lRange(LISTA_RECEBIDAS, 0, -1)).not.toContain(gravada.id);
    });
  });

  describe("US-40 · Cenário 2 · recusada com motivo não segue", () => {
    it("deve ficar recusada com o motivo e fora de staging:pendentes quando a bateria é 150", async () => {
      // Dado (Arrange)
      const estacaoId = randomUUID();
      await cadastrarEstacao(banco, estacaoId);
      const payload = leitura("2026-10-20T12:05:00Z", ',"nivel_bateria":150');

      // Quando (Act)
      await publicarAteGravar(estacaoId, payload);

      // Então (Assert)
      const [gravada] = await hashes(estacaoId);
      await esperar(async () => (await direto.hGet(chaveMensagem(gravada.id), "status")) === "recusada");
      expect(await direto.hGetAll(chaveMensagem(gravada.id))).toMatchObject({
        status: "recusada",
        motivo: "Nível de bateria fora de 0 a 100",
        conteudo: payload,
      });
      expect(await direto.lRange(LISTA_PENDENTES, 0, -1)).not.toContain(gravada.id);
      await new Promise((resolve) => setTimeout(resolve, 500));
      await lerPublicadas();
      expect(publicadas.has(gravada.id)).toBe(false);
    });
  });

  describe("US-40 · Cenário 5 · a mesma leitura chega 2 vezes", () => {
    it("deve publicar em telemetria.bruta uma vez só e deixar a repetição duplicada quando a leitura se repete", async () => {
      // Dado (Arrange)
      const estacaoId = randomUUID();
      await cadastrarEstacao(banco, estacaoId);
      const payload = leitura("2026-10-20T12:07:00Z");
      await publicarAteGravar(estacaoId, payload);
      const antes = (await hashes(estacaoId)).length;

      // Quando (Act)
      await estacao.publishAsync(topicoDe(estacaoId), payload, { qos: 1 });
      await esperar(async () => (await hashes(estacaoId)).length === antes + 1);

      // Então (Assert)
      const ids = (await hashes(estacaoId)).map((h) => h.id);
      await esperar(async () => {
        const todos = await Promise.all(ids.map(status));
        return todos.filter((s) => s === "encaminhada").length === 1
          && todos.filter((s) => s === "duplicada").length === ids.length - 1;
      });
      const [original] = (await Promise.all(ids.map(async (id) => ({ id, s: await status(id) }))))
        .filter(({ s }) => s === "encaminhada");
      const repetidas = ids.filter((id) => id !== original.id);
      await new Promise((resolve) => setTimeout(resolve, 500));
      await lerPublicadas();
      expect(publicadas.has(original.id)).toBe(true);
      expect(repetidas.filter((id) => publicadas.has(id))).toEqual([]);
      expect(await direto.ttl(chaveMensagem(repetidas[0]))).toBeGreaterThan(6 * 24 * 3600);
    });
  });

  describe("US-40 · Cenário 6 · Valkey parado", () => {
    it("deve não confirmar, desconectar e gravar a leitura quando o Valkey volta e o broker a entrega de novo", async () => {
      // Dado (Arrange)
      const estacaoId = randomUUID();
      await cadastrarEstacao(banco, estacaoId);
      await publicarAteGravar(estacaoId, leitura("2026-10-20T12:10:00Z"));
      const payload = leitura("2026-10-20T12:11:00Z");
      const avisos = jest.mocked(console.warn);

      // Quando (Act)
      await proxyValkey.derrubar();
      await estacao.publishAsync(topicoDe(estacaoId), payload, { qos: 1 });
      await esperar(async () =>
        avisos.mock.calls.some(([texto]) => String(texto).includes("desconectando do broker")));
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await proxyValkey.ligar();

      // Então (Assert)
      await esperar(async () => (await hashes(estacaoId)).some((h) => h.conteudo === payload), 30000);
      const daLeitura = (await hashes(estacaoId)).filter((h) => h.conteudo === payload);
      expect(daLeitura).toHaveLength(1);
      await esperar(async () => (await status(daLeitura[0].id)) === "encaminhada", 20000);
    }, 45000);
  });

  describe("US-40 · Cenário 4 · PostgreSQL parado", () => {
    it("deve continuar publicando em telemetria.bruta quando o PostgreSQL para e a estação já foi vista", async () => {
      // Dado (Arrange)
      const estacaoId = randomUUID();
      await cadastrarEstacao(banco, estacaoId);
      await publicarAteGravar(estacaoId, leitura("2026-10-20T12:30:00Z"));
      const [vista] = await hashes(estacaoId);
      await esperar(async () => (await status(vista.id)) === "encaminhada");
      const { rows: sinalAntes } = await banco.query("SELECT ultimo_ping FROM estacoes WHERE id = $1", [estacaoId]);
      const payloads = [leitura("2026-10-20T12:31:00Z"), leitura("2026-10-20T12:32:00Z")];

      // Quando (Act)
      await proxyBanco.derrubar();
      try {
        for (const payload of payloads) await estacao.publishAsync(topicoDe(estacaoId), payload, { qos: 1 });
        await esperar(async () => (await hashes(estacaoId)).length === 3);
        const novas = (await hashes(estacaoId)).filter((h) => payloads.includes(h.conteudo));

        // Então (Assert)
        await esperar(async () => (await Promise.all(novas.map((h) => status(h.id)))).every((s) => s === "encaminhada"), 20000);
        await esperar(async () => {
          await lerPublicadas();
          return novas.every((h) => publicadas.has(h.id));
        });
        expect(novas.map((h) => publicadas.get(h.id))).toEqual(
          novas.map((h) => expect.objectContaining({ staging_id: h.id, estacao_uuid: estacaoId })),
        );
        expect(logger.error).toHaveBeenCalledWith(
          "PostgreSQL indisponível ao atualizar o último sinal; a leitura segue pelo Valkey",
          expect.objectContaining({ stagingId: novas[0].id }),
        );
      } finally {
        await proxyBanco.ligar();
      }
      // US-14: com o PostgreSQL fora o último sinal não muda; volta na próxima leitura.
      const { rows: sinalDepois } = await banco.query("SELECT ultimo_ping FROM estacoes WHERE id = $1", [estacaoId]);
      expect(sinalDepois[0].ultimo_ping).toEqual(sinalAntes[0].ultimo_ping);
      const proxima = leitura("2026-10-20T12:33:00Z");
      await publicarAteGravar(estacaoId, proxima);
      const [daProxima] = (await hashes(estacaoId)).filter((h) => h.conteudo === proxima);
      await esperar(async () => {
        const { rows } = await banco.query("SELECT ultimo_ping FROM estacoes WHERE id = $1", [estacaoId]);
        return rows[0].ultimo_ping?.toISOString() === daProxima.recebidoEm;
      }, 20000);
    }, 60000);
  });

  describe("US-40 · erro temporário: PostgreSQL fora e estação nunca vista", () => {
    it("deve confirmar e manter recebida sem mexer no último sinal, e verificar quando o PostgreSQL volta", async () => {
      // Dado (Arrange)
      const estacaoId = randomUUID();
      await cadastrarEstacao(banco, estacaoId);
      const payload = leitura("2026-10-20T12:20:00Z");

      // Quando (Act)
      await proxyBanco.derrubar();
      await estacao.publishAsync(topicoDe(estacaoId), payload, { qos: 1 });
      await esperar(async () => (await hashes(estacaoId)).length === 1);
      const [gravada] = await hashes(estacaoId);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const statusComBancoFora = await direto.hGet(chaveMensagem(gravada.id), "status");
      const { rows: sinal } = await banco.query("SELECT ultimo_ping FROM estacoes WHERE id = $1", [estacaoId]);
      await proxyBanco.ligar();

      // Então (Assert)
      expect(statusComBancoFora).toBe("recebida");
      expect(sinal[0].ultimo_ping).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        "Verificação adiada para a próxima rodada",
        expect.objectContaining({ stagingId: gravada.id }),
      );
      await esperar(async () => (await status(gravada.id)) === "encaminhada", 20000);
      const { rows: depois } = await banco.query("SELECT ultimo_ping FROM estacoes WHERE id = $1", [estacaoId]);
      expect(depois[0].ultimo_ping.toISOString()).toBe(gravada.recebidoEm);
    }, 45000);
  });

  describe("US-21 · GET /ingestao/metricas lido do Valkey", () => {
    const metricas = async () => {
      const resposta = await request(app)
        .get("/ingestao/metricas")
        .set("Authorization", `Bearer ${jwt.sign({ id: "adm", papel: "ADMINISTRADOR" }, JWT_TESTE)}`);
      expect(resposta.status).toBe(200);
      return resposta.body;
    };

    it("deve bater com o publicado em telemetria.bruta quando chegam leituras aceitas, recusadas e repetidas", async () => {
      // Dado (Arrange)
      const estacaoId = randomUUID();
      await cadastrarEstacao(banco, estacaoId);
      const antes = await metricas();
      const aceitaA = leitura("2026-10-20T13:00:00Z");
      const aceitaB = leitura("2026-10-20T13:01:00Z");
      const recusada = leitura("2026-10-20T13:02:00Z", ',"nivel_bateria":150');

      // Quando (Act)
      await publicarAteGravar(estacaoId, aceitaA);
      for (const payload of [aceitaA, aceitaB, recusada]) {
        await estacao.publishAsync(topicoDe(estacaoId), payload, { qos: 1 });
      }
      await esperar(async () => {
        const todas = await hashes(estacaoId);
        return todas.some((h) => h.conteudo === recusada)
          && todas.some((h) => h.conteudo === aceitaB)
          && todas.every((h) => ["encaminhada", "recusada", "duplicada"].includes(h.status));
      }, 20000);
      await lerPublicadas();
      const depois = await metricas();

      // Então (Assert)
      const todas = await hashes(estacaoId);
      const publicadasDaEstacao = todas.filter((h) => publicadas.has(h.id));
      const conta = (status: string) => todas.filter((h) => h.status === status).length;
      expect(conta("encaminhada")).toBe(2);
      expect(publicadasDaEstacao.map((h) => h.status)).toEqual(["encaminhada", "encaminhada"]);
      expect(depois.mensagensEncaminhadas - antes.mensagensEncaminhadas).toBe(publicadasDaEstacao.length);
      expect(depois.leiturasRecebidas - antes.leiturasRecebidas).toBe(todas.length);
      expect(depois.duplicadasIgnoradas - antes.duplicadasIgnoradas).toBe(conta("duplicada"));
      expect(conta("duplicada")).toBeGreaterThanOrEqual(1);
      const bateria = "Nível de bateria fora de 0 a 100";
      expect((depois.leiturasRejeitadas[bateria] ?? 0) - (antes.leiturasRejeitadas[bateria] ?? 0)).toBe(1);
      expect(depois).toMatchObject({ mensagensPendentes: 0, pendenteMaisAntigaEm: null });
    }, 45000);

    it("deve informar as pendentes e o horário de chegada da mais antiga quando o RabbitMQ não publica", async () => {
      // Dado (Arrange)
      const estacaoId = randomUUID();
      await cadastrarEstacao(banco, estacaoId);
      await encerrarPublisherStaging();
      const payloads = [leitura("2026-10-20T13:10:00Z"), leitura("2026-10-20T13:11:00Z")];

      // Quando (Act)
      try {
        for (const payload of payloads) await publicarAteGravar(estacaoId, payload);
        await esperar(async () => (await direto.lLen(LISTA_PENDENTES)) >= 2);
        const comPendentes = await metricas();

        // Então (Assert)
        const [primeira] = await direto.lRange(LISTA_PENDENTES, 0, 0);
        expect(comPendentes.mensagensPendentes).toBe(await direto.lLen(LISTA_PENDENTES));
        expect(comPendentes.pendenteMaisAntigaEm).toBe(await direto.hGet(chaveMensagem(primeira), "recebidoEm"));
      } finally {
        const publicador = new RabbitMqTelemetriaPublisher({ url: RABBITMQ_TEST_URL as string, intervaloRecuperacaoMs: 300 });
        configurarPublisherStaging(publicador);
        await publicador.iniciar();
      }
      await esperar(async () => (await metricas()).mensagensPendentes === 0, 20000);
      expect((await metricas()).pendenteMaisAntigaEm).toBeNull();
    }, 45000);
  });
});
