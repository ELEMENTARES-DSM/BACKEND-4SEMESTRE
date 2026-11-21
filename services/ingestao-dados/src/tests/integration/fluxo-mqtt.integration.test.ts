import net from "net";
import { randomUUID } from "node:crypto";
import mqtt from "mqtt";
import { createBroker } from "aedes";
import { pool } from "../../config/db";
import { encerrarValkey, valkey } from "../../config/valkey";
import { ConsumidorMqttTelemetria } from "../../events/consumers/mqtt-telemetria.consumer";
import { RabbitMqTelemetriaPublisher } from "../../events/publishers/rabbitmq-telemetria.publisher";
import { lerMetricas, LISTA_PENDENTES, LISTA_RECEBIDAS } from "../../repositories/staging-valkey.repository";
import {
  encerrarVerificacao,
  iniciarVerificacao,
  receberMensagem,
} from "../../services/processar-mensagem.service";
import { configurarPublisherStaging } from "../../services/staging-publisher.service";
import { logger } from "../../utils/logger";
import { cadastrarEstacao, criarTabelaEstacoes } from "./helpers/estacoes";
import { esperar, usarValkeyDeTeste } from "./helpers/valkey";

// TASK 11.05: mensagem publicada no MQTT percorre o fluxo inteiro da ingestão
// (Valkey, validação, estação, duplicata e último sinal) com Valkey e
// PostgreSQL de teste. O broker é o aedes em memória, isolado por arquivo; a
// publicação no RabbitMQ é só observada.
const integration = describe;

const topicoDe = (uuid: string) => `pulso/estacoes/${uuid}/telemetria`;

integration("TASK 11.05 · fluxo MQTT → Valkey → verificação", () => {
  const schema = `fluxo_mqtt_test_${randomUUID().replaceAll("-", "")}`;
  const broker = createBroker();
  const servidor = net.createServer(broker.handle);
  const processarPendentes = jest.fn(async () => undefined);
  let consumidor: ConsumidorMqttTelemetria;
  let estacao: mqtt.MqttClient;

  const payload = (timestamp: string, extras = "") =>
    `{"timestamp":"${timestamp}"${extras},"leituras":[{"sensor":"T-01","valor":25.4}]}`;

  // Mensagens da estação no Valkey (o banco lógico é só deste arquivo).
  const mensagensDa = async (estacaoId: string) => {
    const hashes = await Promise.all(
      (await valkey().keys("staging:msg:*")).map((chave) => valkey().hGetAll(chave)),
    );
    return hashes.filter((h) => h.topico === topicoDe(estacaoId));
  };

  const sinalEstacao = async (estacaoId: string) => {
    const { rows } = await pool.query("SELECT ultimo_ping, nivel_bateria FROM estacoes WHERE id = $1", [estacaoId]);
    return rows[0];
  };

  // Gravadas no Valkey e já verificadas (a fila de verificação esvaziou).
  const esperarVerificadas = async (total: number) => {
    await esperar(async () => (await lerMetricas()).leiturasRecebidas === total);
    await esperar(async () => (await valkey().lLen(LISTA_RECEBIDAS)) === 0);
  };

  beforeAll(async () => {
    // O módulo db é carregado antes dos hooks: configurar o pool explicitamente.
    pool.options.connectionString = process.env.STAGING_TEST_DATABASE_URL;
    pool.options.options = `-c search_path=${schema}`;
    await pool.query(`CREATE SCHEMA ${schema}`);
    await criarTabelaEstacoes(pool);
    await usarValkeyDeTeste(3);

    configurarPublisherStaging({ processarPendentes } as unknown as RabbitMqTelemetriaPublisher);
    iniciarVerificacao(300);

    await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
    const { port } = servidor.address() as net.AddressInfo;
    const assinou = new Promise<void>((resolve) => {
      broker.on("subscribe", (_subs, cliente) => {
        if (cliente?.id === "ingestao-dados") resolve();
      });
    });
    consumidor = new ConsumidorMqttTelemetria({
      // US-29: sem usuário e senha, como o Mosquitto do compose.
      config: { brokerUrl: `mqtt://127.0.0.1:${port}`, qos: 1 },
      proximoPasso: receberMensagem,
      reentregaMs: 300,
    });
    consumidor.iniciar();
    await assinou;
    estacao = await mqtt.connectAsync(`mqtt://127.0.0.1:${port}`, { clientId: `estacao-${randomUUID()}` });
  });

  afterAll(async () => {
    try {
      encerrarVerificacao();
      await consumidor.encerrar();
      await new Promise<void>((resolve) => estacao.end(true, {}, () => resolve()));
      await new Promise<void>((resolve) => broker.close(() => servidor.close(() => resolve())));
      await valkey().flushDb();
      await encerrarValkey();
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await pool.end();
    }
  });

  beforeEach(async () => {
    jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    jest.spyOn(logger, "info").mockImplementation(() => undefined);
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    processarPendentes.mockResolvedValue(undefined);
    await pool.query("TRUNCATE estacoes");
    // O publicador é falso aqui: pendentes e contadores de um teste não podem
    // contar no seguinte (o banco lógico 3 é só deste arquivo).
    await valkey().flushDb();
  });

  it("deve marcar pendente, atualizar o último sinal e pedir a publicação quando a leitura é válida", async () => {
    // Dado (Arrange)
    const estacaoId = randomUUID();
    await cadastrarEstacao(pool, estacaoId, "Com Falha");

    // Quando (Act)
    await estacao.publishAsync(topicoDe(estacaoId), payload("2026-10-20T12:00:00Z", ',"nivel_bateria":87'), { qos: 1 });
    await esperarVerificadas(1);

    // Então (Assert)
    const [gravada] = await mensagensDa(estacaoId);
    expect(gravada.status).toBe("pendente");
    const sinal = await sinalEstacao(estacaoId);
    expect(sinal.nivel_bateria).toBe(87);
    expect(sinal.ultimo_ping.toISOString()).toBe(gravada.recebidoEm);
    expect(processarPendentes).toHaveBeenCalledTimes(1);
  });

  it("deve marcar recusada com o motivo e somar em leiturasRejeitadas quando o payload é inválido", async () => {
    // Dado (Arrange)
    const estacaoId = randomUUID();
    await cadastrarEstacao(pool, estacaoId);

    // Quando (Act)
    await estacao.publishAsync(topicoDe(estacaoId), "texto solto", { qos: 1 });
    await esperarVerificadas(1);

    // Então (Assert)
    expect(await mensagensDa(estacaoId)).toEqual([
      expect.objectContaining({ status: "recusada", motivo: "Payload malformado", conteudo: "texto solto" }),
    ]);
    expect((await lerMetricas()).leiturasRejeitadas).toEqual({ "Payload malformado": 1 });
    expect((await sinalEstacao(estacaoId)).ultimo_ping).toBeNull();
    expect(processarPendentes).not.toHaveBeenCalled();
  });

  describe("US-40 · Cenário 5 · a mesma leitura chega 2 vezes", () => {
    it("deve seguir 1 vez só e deixar a repetição duplicada quando a mensagem se repete", async () => {
      // Dado (Arrange)
      const estacaoId = randomUUID();
      await cadastrarEstacao(pool, estacaoId);
      const mensagem = payload("2026-10-20T12:05:00Z");

      // Quando (Act)
      await estacao.publishAsync(topicoDe(estacaoId), mensagem, { qos: 1 });
      await estacao.publishAsync(topicoDe(estacaoId), mensagem, { qos: 1 });
      await esperarVerificadas(2);

      // Então (Assert)
      const status = (await mensagensDa(estacaoId)).map((h) => h.status).sort();
      expect(status).toEqual(["duplicada", "pendente"]);
      expect(await lerMetricas()).toMatchObject({
        leiturasRecebidas: 2,
        leiturasRejeitadas: {},
        duplicadasIgnoradas: 1,
        mensagensPendentes: 1,
      });
    });
  });

  it("deve marcar recusada com o motivo da US-12 quando a estação é desconhecida ou inativa", async () => {
    // Dado (Arrange)
    const desconhecida = randomUUID();
    const inativa = randomUUID();
    await cadastrarEstacao(pool, inativa, "Inativa");

    // Quando (Act)
    await estacao.publishAsync(topicoDe(desconhecida), payload("2026-10-20T12:10:00Z"), { qos: 1 });
    await estacao.publishAsync(topicoDe(inativa), payload("2026-10-20T12:10:00Z"), { qos: 1 });
    await esperarVerificadas(2);

    // Então (Assert)
    expect(await mensagensDa(desconhecida)).toEqual([
      expect.objectContaining({ status: "recusada", motivo: "Estação desconhecida" }),
    ]);
    expect(await mensagensDa(inativa)).toEqual([
      expect.objectContaining({ status: "recusada", motivo: "Estação inativa" }),
    ]);
    expect((await sinalEstacao(inativa)).ultimo_ping).toBeNull();
    expect((await lerMetricas()).leiturasRejeitadas).toEqual({ "Estação desconhecida": 1, "Estação inativa": 1 });
  });

  it("deve somar 1 em leiturasRecebidas por mensagem gravada quando ela é aceita, recusada ou duplicada", async () => {
    // Dado (Arrange)
    const estacaoId = randomUUID();
    await cadastrarEstacao(pool, estacaoId);
    const valida = payload("2026-10-20T12:15:00Z");

    // Quando (Act)
    await estacao.publishAsync(topicoDe(estacaoId), valida, { qos: 1 });
    await estacao.publishAsync(topicoDe(estacaoId), "{}", { qos: 1 });
    await estacao.publishAsync(topicoDe(estacaoId), valida, { qos: 1 });
    await esperarVerificadas(3);

    // Então (Assert)
    expect(await mensagensDa(estacaoId)).toHaveLength(3);
    expect((await lerMetricas()).leiturasRecebidas).toBe(3);
  });

  it("deve contar em leiturasRecebidas a mensagem de tópico fora do padrão, porque ela é gravada e depois recusada", async () => {
    // Dado (Arrange)
    // Quando (Act)
    await estacao.publishAsync("pulso/estacoes/est-001/telemetria", payload("2026-10-20T12:16:00Z"), { qos: 1 });
    await esperarVerificadas(1);

    // Então (Assert)
    expect(await lerMetricas()).toMatchObject({
      leiturasRecebidas: 1,
      leiturasRejeitadas: { "Estação desconhecida": 1 },
    });
  });

  describe("US-14 · último sinal com o PostgreSQL fora", () => {
    it("deve seguir para a publicação e atualizar o último sinal só na próxima leitura quando a tabela estacoes está fora", async () => {
      // Dado (Arrange)
      const estacaoId = randomUUID();
      await cadastrarEstacao(pool, estacaoId);
      await estacao.publishAsync(topicoDe(estacaoId), payload("2026-10-20T12:20:00Z"), { qos: 1 });
      await esperarVerificadas(1);
      const sinalAntes = (await sinalEstacao(estacaoId)).ultimo_ping;
      const erroLog = jest.spyOn(logger, "error").mockImplementation(() => undefined);
      // Tira a tabela do ar: a conferência usa o último cadastro lido e o
      // último sinal falha.
      await pool.query("ALTER TABLE estacoes RENAME TO estacoes_fora");

      // Quando (Act)
      try {
        await estacao.publishAsync(topicoDe(estacaoId), payload("2026-10-20T12:21:00Z"), { qos: 1 });
        await esperarVerificadas(2);
      } finally {
        await pool.query("ALTER TABLE estacoes_fora RENAME TO estacoes");
      }
      const sinalComBancoFora = (await sinalEstacao(estacaoId)).ultimo_ping;
      await estacao.publishAsync(topicoDe(estacaoId), payload("2026-10-20T12:22:00Z"), { qos: 1 });
      await esperarVerificadas(3);

      // Então (Assert)
      expect(await valkey().lLen(LISTA_PENDENTES)).toBe(3);
      expect(processarPendentes).toHaveBeenCalledTimes(3);
      expect(erroLog).toHaveBeenCalledWith(
        "PostgreSQL indisponível ao atualizar o último sinal; a leitura segue pelo Valkey",
        expect.objectContaining({ erro: expect.stringContaining("estacoes") }),
      );
      expect(sinalComBancoFora).toEqual(sinalAntes);
      const ultima = (await mensagensDa(estacaoId)).map((h) => h.recebidoEm).sort().at(-1);
      expect((await sinalEstacao(estacaoId)).ultimo_ping.toISOString()).toBe(ultima);
    }, 30000);
  });
});
