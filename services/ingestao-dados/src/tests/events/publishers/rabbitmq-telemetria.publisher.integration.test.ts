import { randomUUID } from "node:crypto";
import amqp, { Channel, ConfirmChannel } from "amqplib";
import { encerrarValkey, valkey } from "../../../config/valkey";
import {
  EXCHANGE_TELEMETRIA_BRUTA,
  FILA_VALIDACAO_DLQ,
  FILA_VALIDACAO_TELEMETRIA,
  RabbitMqTelemetriaPublisher,
} from "../../../events/publishers/rabbitmq-telemetria.publisher";
import {
  chaveMensagem,
  gravarBruta,
  LISTA_PENDENTES,
  marcarPendente,
  RETENCAO_MS,
} from "../../../repositories/staging-valkey.repository";
import { ProxyTcp } from "../../integration/helpers/proxy-tcp";
import { esperar, usarValkeyDeTeste } from "../../integration/helpers/valkey";

// US-40 · publicação a partir do Valkey com RabbitMQ e Valkey de teste em container.
const rabbitUrl = process.env.RABBITMQ_TEST_URL;
const integration = rabbitUrl && process.env.VALKEY_TEST_URL ? describe : describe.skip;

const MAC = "aabbccddeeff";
const ESTACAO = "8723c462-e79c-4e58-9751-eef8868a5312";

integration("US-40 · publicador de telemetria.bruta a partir do Valkey", () => {
  const publicadores: RabbitMqTelemetriaPublisher[] = [];
  let admin: amqp.ChannelModel;
  let canal: Channel;
  // Fila só deste arquivo, ligada ao fanout: recebe cópia de tudo que é publicado.
  let observada: string;

  async function novaPendente(segundo: number): Promise<string> {
    const id = await gravarBruta({
      topico: `pulso/estacoes/${MAC}/telemetria`,
      payloadBruto: `{"timestamp":"2026-11-16T10:00:${String(segundo).padStart(2, "0")}Z","leituras":[{"sensor":"TMP","valor":${segundo}}]}`,
      recebidoEm: new Date().toISOString(),
    });
    await marcarPendente(id, ESTACAO);
    return id;
  }

  // Lê da fila observada os staging_id dos ids esperados, na ordem em que chegaram.
  async function chegaram(ids: string[], limiteMs = 15000): Promise<string[]> {
    const recebidos: string[] = [];
    await esperar(async () => {
      const mensagem = await canal.get(observada, { noAck: true });
      if (mensagem) {
        const evento = JSON.parse(mensagem.content.toString()) as { staging_id: string };
        if (ids.includes(evento.staging_id)) recebidos.push(evento.staging_id);
      }
      return recebidos.length === ids.length;
    }, limiteMs);
    return recebidos;
  }

  function criarPublicador(opcoes: Partial<ConstructorParameters<typeof RabbitMqTelemetriaPublisher>[0]> = {}) {
    const publicador = new RabbitMqTelemetriaPublisher({
      url: rabbitUrl as string,
      intervaloRecuperacaoMs: 10000,
      ...opcoes,
    });
    publicadores.push(publicador);
    return publicador;
  }

  beforeAll(async () => {
    await usarValkeyDeTeste(5);
    admin = await amqp.connect(rabbitUrl as string);
    canal = await admin.createChannel();
    await canal.assertExchange(EXCHANGE_TELEMETRIA_BRUTA, "fanout", { durable: true });
    observada = (await canal.assertQueue("", { exclusive: true })).queue;
    await canal.bindQueue(observada, EXCHANGE_TELEMETRIA_BRUTA, "");
  });

  beforeEach(async () => {
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    await valkey().flushDb();
    await canal.purgeQueue(observada);
  });

  afterEach(async () => {
    await Promise.all(publicadores.splice(0).map((publicador) => publicador.encerrar()));
  });

  afterAll(async () => {
    await canal.close();
    await admin.close();
    await valkey().flushDb();
    await encerrarValkey();
  });

  it("deve publicar 50 pendentes na ordem da lista, com staging_id igual ao id do Valkey, quando o RabbitMQ está no ar", async () => {
    // Dado (Arrange)
    const ids: string[] = [];
    for (let segundo = 0; segundo < 50; segundo += 1) ids.push(await novaPendente(segundo));

    // Quando (Act)
    await criarPublicador().iniciar();

    // Então (Assert)
    expect(await chegaram(ids)).toEqual(ids);
    await esperar(async () => (await valkey().lLen(LISTA_PENDENTES)) === 0);
    for (const id of ids) expect(await valkey().hGet(chaveMensagem(id), "status")).toBe("encaminhada");
  });

  describe("US-40 · Cenário 3 · fila fora do ar", () => {
    it("deve manter 3 pendentes com o RabbitMQ parado e publicá-las na ordem de chegada quando ele volta", async () => {
      // Dado (Arrange)
      const destino = new URL(rabbitUrl as string);
      const proxy = new ProxyTcp(destino.hostname, Number(destino.port || 5672));
      const viaProxy = new URL(rabbitUrl as string);
      viaProxy.hostname = "127.0.0.1";
      viaProxy.port = String(await proxy.ligar());
      const publicador = criarPublicador({ url: viaProxy.toString(), reconectarMs: 200, intervaloRecuperacaoMs: 200 });
      await publicador.iniciar();
      await esperar(async () => publicador.conectado());

      // Quando (Act)
      await proxy.derrubar();
      await esperar(async () => !publicador.conectado());
      const ids = [await novaPendente(1), await novaPendente(2), await novaPendente(3)];
      publicador.processarPendentes();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const comRabbitParado = await valkey().lRange(LISTA_PENDENTES, 0, -1);
      const statusComRabbitParado = await Promise.all(ids.map((id) => valkey().hGet(chaveMensagem(id), "status")));
      await proxy.ligar();

      // Então (Assert)
      expect(comRabbitParado).toEqual(ids);
      expect(statusComRabbitParado).toEqual(["pendente", "pendente", "pendente"]);
      expect(await chegaram(ids)).toEqual(ids);
      await esperar(async () => (await valkey().lLen(LISTA_PENDENTES)) === 0);
      // Encerra antes de cortar o proxy: o close do amqplib espera a resposta do broker.
      await publicador.encerrar();
      await proxy.derrubar();
    }, 30000);

    it("deve publicar a pendente quando a primeira conexão falha e a reconexão funciona", async () => {
      // Dado (Arrange)
      const id = await novaPendente(1);
      let falhar = true;
      const publicador = criarPublicador({
        conectar: async (url) => {
          if (falhar) {
            falhar = false;
            throw new Error("indisponibilidade simulada no primeiro connect");
          }
          return amqp.connect(url);
        },
        reconectarMs: 50,
        intervaloRecuperacaoMs: 50,
      });

      // Quando (Act)
      await publicador.iniciar();
      const depoisDaFalha = await valkey().hGet(chaveMensagem(id), "status");

      // Então (Assert)
      expect(depoisDaFalha).toBe("pendente");
      expect(await chegaram([id])).toEqual([id]);
      await esperar(async () => (await valkey().hGet(chaveMensagem(id), "status")) === "encaminhada");
    });

    it("deve publicar pela rodada periódica quando a pendente entra sem pedido de publicação", async () => {
      // Dado (Arrange)
      const publicador = criarPublicador({ intervaloRecuperacaoMs: 75 });
      await publicador.iniciar();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Quando (Act)
      const id = await novaPendente(1);

      // Então (Assert)
      expect(await chegaram([id])).toEqual([id]);
    });
  });

  describe("US-40 · Cenário 7 · expiração em 7 dias", () => {
    it("deve tirar do Valkey a encaminhada há mais de 7 dias e manter a pendente quando o relógio é simulado", async () => {
      // Dado (Arrange)
      const encaminhada = await novaPendente(1);
      const oitoDiasAtras = new Date(Date.now() - RETENCAO_MS - 24 * 60 * 60 * 1000);
      const publicador = criarPublicador({ agora: () => oitoDiasAtras });
      await publicador.iniciar();
      await chegaram([encaminhada]);
      await publicador.encerrar();

      // Quando (Act)
      const pendente = await novaPendente(2);

      // Então (Assert)
      await esperar(async () => (await valkey().exists(chaveMensagem(encaminhada))) === 0);
      expect(await valkey().hGet(chaveMensagem(pendente), "status")).toBe("pendente");
      expect(await valkey().ttl(chaveMensagem(pendente))).toBe(-1);
    });

    it("deve expirar a encaminhada em 7 dias quando o relógio é o real", async () => {
      // Dado (Arrange)
      const id = await novaPendente(1);

      // Quando (Act)
      await criarPublicador().iniciar();
      await chegaram([id]);
      await esperar(async () => (await valkey().hGet(chaveMensagem(id), "status")) === "encaminhada");

      // Então (Assert)
      const ttl = await valkey().ttl(chaveMensagem(id));
      expect(ttl).toBeGreaterThan(RETENCAO_MS / 1000 - 60);
      expect(ttl).toBeLessThanOrEqual(RETENCAO_MS / 1000);
    });
  });

  it("deve recriar a fila e o vínculo ausentes antes de publicar quando a topologia foi apagada", async () => {
    // Dado (Arrange)
    const temporario = await admin.createChannel();
    await temporario.deleteQueue(FILA_VALIDACAO_TELEMETRIA);
    await temporario.deleteQueue(FILA_VALIDACAO_DLQ);
    await temporario.close();
    const id = await novaPendente(1);

    // Quando (Act)
    await criarPublicador().iniciar();

    // Então (Assert)
    expect(await chegaram([id])).toEqual([id]);
    const conferir = await admin.createChannel();
    await expect(conferir.checkQueue(FILA_VALIDACAO_TELEMETRIA)).resolves.toMatchObject({ queue: FILA_VALIDACAO_TELEMETRIA });
    await expect(conferir.checkQueue(FILA_VALIDACAO_DLQ)).resolves.toMatchObject({ queue: FILA_VALIDACAO_DLQ });
    await conferir.close();
  });

  it("deve rejeitar a confirmação positiva quando mandatory devolve a mensagem sem rota", async () => {
    // Dado (Arrange)
    const publicador = criarPublicador();
    const connection = await amqp.connect(rabbitUrl as string);
    const channel = await connection.createConfirmChannel();
    const exchangeSemFila = `teste.sem.rota.${randomUUID()}`;
    await channel.assertExchange(exchangeSemFila, "fanout", { durable: false, autoDelete: true });
    // publicarConfirmado usa o exchange fixo: aqui o canal publica num exchange sem fila ligada.
    const publicar = channel.publish.bind(channel);
    jest.spyOn(channel, "publish").mockImplementation(
      (_exchange, rota, conteudo, opcoes, callback) => publicar(exchangeSemFila, rota, conteudo, opcoes, callback),
    );
    const publicarConfirmado = (
      publicador as unknown as { publicarConfirmado: (c: ConfirmChannel, evento: unknown) => Promise<void> }
    ).publicarConfirmado.bind(publicador);

    // Quando (Act)
    const resultado = publicarConfirmado(channel, { staging_id: randomUUID(), unixtime: Math.floor(Date.now() / 1000) });

    // Então (Assert)
    await expect(resultado).rejects.toThrow("NO_ROUTE");
    await channel.close();
    await connection.close();
  });
});
