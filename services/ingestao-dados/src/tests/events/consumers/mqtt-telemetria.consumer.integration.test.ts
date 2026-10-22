import net from "net";
import mqtt from "mqtt";
import { createBroker } from "aedes";
import { MensagemIngestaoInput } from "../../../dto/mensagem-ingestao.dto";
import {
  ConsumidorMqttTelemetria,
  OpcoesConsumidorMqtt,
} from "../../../events/consumers/mqtt-telemetria.consumer";
import { MqttStatusService } from "../../../services/mqtt-status.service";

// Broker MQTT em memória (aedes) e clientes reais do mqtt.js: testa o protocolo de verdade,
// sem Docker. Cobre sessão persistente e reconexão, que o cliente falso não consegue provar.

const UUID_A = "8723c462-e79c-4e58-9751-eef8868a5312";
const UUID_B = "e30a57e3-0d33-4f9e-86b2-6cb1690a7891";
const UUID_C = "5f0c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f";

const topicoDe = (uuid: string) => `pulso/estacoes/${uuid}/telemetria`;

interface BrokerDeTeste {
  broker: ReturnType<typeof createBroker>;
  servidor: net.Server;
  sockets: Set<net.Socket>;
  porta: number;
}

const brokers: BrokerDeTeste[] = [];
const consumidores: ConsumidorMqttTelemetria[] = [];
const publicadores: mqtt.MqttClient[] = [];

function iniciarBroker(porta = 0): Promise<BrokerDeTeste> {
  return new Promise((resolve, reject) => {
    const broker = createBroker();
    const servidor = net.createServer(broker.handle);
    const sockets = new Set<net.Socket>();

    servidor.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    servidor.once("error", reject);
    servidor.listen(porta, "127.0.0.1", () => {
      const { port } = servidor.address() as net.AddressInfo;
      const teste = { broker, servidor, sockets, porta: port };
      brokers.push(teste);
      resolve(teste);
    });
  });
}

// Derruba as conexões abertas e fecha o servidor, como uma queda do broker.
function derrubarBroker(teste: BrokerDeTeste): Promise<void> {
  return new Promise((resolve) => {
    for (const socket of teste.sockets) socket.destroy();
    teste.broker.close(() => {
      teste.servidor.close(() => resolve());
    });
  });
}

async function conectarEstacao(porta: number, uuid: string): Promise<mqtt.MqttClient> {
  const cliente = await mqtt.connectAsync(`mqtt://127.0.0.1:${porta}`, {
    clientId: `estacao-${uuid}`,
    username: uuid,
    password: "teste",
  });
  publicadores.push(cliente);
  return cliente;
}

function criarConsumidor(
  porta: number,
  recebidas: MensagemIngestaoInput[],
  deps: Pick<OpcoesConsumidorMqtt, "estadoConexao"> = {},
) {
  const consumidor = new ConsumidorMqttTelemetria({
    config: {
      brokerUrl: `mqtt://127.0.0.1:${porta}`,
      usuario: "ingestao-dados",
      senha: "teste",
      qos: 1,
    },
    proximoPasso: async (mensagem) => {
      recebidas.push(mensagem);
    },
    ...deps,
  });
  consumidores.push(consumidor);
  return consumidor;
}

async function esperar(condicao: () => boolean | Promise<boolean>, limiteMs = 10000): Promise<void> {
  const inicio = Date.now();
  while (!(await condicao())) {
    if (Date.now() - inicio > limiteMs) {
      throw new Error("tempo esgotado esperando a condição");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

// Publica até o consumidor receber, para confirmar que ele já está assinado.
// Repetir evita a corrida entre a conexão do consumidor e a primeira publicação.
async function aguardarAssinatura(
  recebidas: MensagemIngestaoInput[],
  publicador: mqtt.MqttClient,
  payload = "prova",
) {
  await esperar(async () => {
    if (recebidas.some((m) => m.payloadBruto === payload)) return true;
    await publicador.publishAsync(topicoDe(UUID_A), payload, { qos: 1 });
    return false;
  }, 15000);
  recebidas.length = 0;
}

describe("ConsumidorMqttTelemetria (integração com broker MQTT)", () => {
  let warn: jest.SpyInstance;
  let log: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    log = jest.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await Promise.all(consumidores.splice(0).map((c) => c.encerrar()));
    await Promise.all(
      publicadores.splice(0).map((c) => new Promise<void>((resolve) => c.end(true, {}, () => resolve()))),
    );
    await Promise.all(brokers.splice(0).map((b) => derrubarBroker(b)));
    jest.restoreAllMocks();
  });

  test("recebe a telemetria de uma estação com estacaoId e payload intacto", async () => {
    const broker = await iniciarBroker();
    const recebidas: MensagemIngestaoInput[] = [];
    const consumidor = criarConsumidor(broker.porta, recebidas);
    consumidor.iniciar();

    const estacao = await conectarEstacao(broker.porta, UUID_A);
    await aguardarAssinatura(recebidas, estacao);

    const payload = '{"timestamp":"2026-10-09T12:00:00Z","leituras":[{"sensor":"TMP","valor":25.4}]}';
    await estacao.publishAsync(topicoDe(UUID_A), payload, { qos: 1 });
    await esperar(() => recebidas.length === 1);

    expect(recebidas[0]).toMatchObject({
      estacaoId: UUID_A,
      topico: topicoDe(UUID_A),
      payloadBruto: payload,
    });
    expect(recebidas[0].recebidoEm).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test("identifica cada estação quando várias publicam ao mesmo tempo", async () => {
    const broker = await iniciarBroker();
    const recebidas: MensagemIngestaoInput[] = [];
    criarConsumidor(broker.porta, recebidas).iniciar();

    const publicador = await conectarEstacao(broker.porta, UUID_A);
    await aguardarAssinatura(recebidas, publicador);

    const estacoes = [UUID_A, UUID_B, UUID_C];
    const clientes = await Promise.all(estacoes.map((uuid) => conectarEstacao(broker.porta, uuid)));

    await Promise.all(
      clientes.flatMap((cliente, i) =>
        [1, 2, 3].map((n) => cliente.publishAsync(topicoDe(estacoes[i]), `${estacoes[i]}-${n}`, { qos: 1 })),
      ),
    );
    await esperar(() => recebidas.length === 9);

    for (const uuid of estacoes) {
      const doUuid = recebidas.filter((m) => m.estacaoId === uuid);
      expect(doUuid.map((m) => m.payloadBruto).sort()).toEqual([`${uuid}-1`, `${uuid}-2`, `${uuid}-3`]);
    }
  });

  test("entrega duas vezes a mesma mensagem publicada duas vezes", async () => {
    const broker = await iniciarBroker();
    const recebidas: MensagemIngestaoInput[] = [];
    criarConsumidor(broker.porta, recebidas).iniciar();

    const estacao = await conectarEstacao(broker.porta, UUID_A);
    await aguardarAssinatura(recebidas, estacao);

    const payload = '{"timestamp":"2026-10-09T12:00:00Z","leituras":[]}';
    await estacao.publishAsync(topicoDe(UUID_A), payload, { qos: 1 });
    await estacao.publishAsync(topicoDe(UUID_A), payload, { qos: 1 });
    await esperar(() => recebidas.length === 2);

    expect(recebidas[0].payloadBruto).toBe(recebidas[1].payloadBruto);
  });

  test("não entrega tópico com UUID inválido e continua recebendo os válidos", async () => {
    const broker = await iniciarBroker();
    const recebidas: MensagemIngestaoInput[] = [];
    criarConsumidor(broker.porta, recebidas).iniciar();

    const estacao = await conectarEstacao(broker.porta, UUID_A);
    await aguardarAssinatura(recebidas, estacao);

    await estacao.publishAsync("pulso/estacoes/est-001/telemetria", "invalida", { qos: 1 });
    await estacao.publishAsync(topicoDe(UUID_A), "valida", { qos: 1 });
    await esperar(() => recebidas.length === 1);

    expect(recebidas[0].payloadBruto).toBe("valida");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("pulso/estacoes/est-001/telemetria"));
  });

  test("recupera mensagens publicadas enquanto o consumidor estava parado (sessão persistente)", async () => {
    const broker = await iniciarBroker();
    const recebidasAntes: MensagemIngestaoInput[] = [];
    const primeiro = criarConsumidor(broker.porta, recebidasAntes);
    primeiro.iniciar();

    const estacao = await conectarEstacao(broker.porta, UUID_A);
    await aguardarAssinatura(recebidasAntes, estacao);

    await primeiro.encerrar();

    await estacao.publishAsync(topicoDe(UUID_A), "enquanto-parado-1", { qos: 1 });
    await estacao.publishAsync(topicoDe(UUID_A), "enquanto-parado-2", { qos: 1 });

    const recebidasDepois: MensagemIngestaoInput[] = [];
    criarConsumidor(broker.porta, recebidasDepois).iniciar();
    await esperar(() => recebidasDepois.length === 2);

    expect(recebidasDepois.map((m) => m.payloadBruto)).toEqual(["enquanto-parado-1", "enquanto-parado-2"]);
  });

  test("reconecta sozinho e reassina quando o broker cai e volta", async () => {
    const broker = await iniciarBroker();
    const porta = broker.porta;
    const recebidas: MensagemIngestaoInput[] = [];
    criarConsumidor(porta, recebidas).iniciar();

    const estacaoAntes = await conectarEstacao(porta, UUID_A);
    await aguardarAssinatura(recebidas, estacaoAntes);

    await derrubarBroker(broker);
    brokers.splice(brokers.indexOf(broker), 1);
    // O publicador também tenta reconectar sozinho: precisa ser encerrado aqui, senão vaza.
    await new Promise<void>((resolve) => estacaoAntes.end(true, {}, () => resolve()));
    publicadores.splice(publicadores.indexOf(estacaoAntes), 1);

    // Mesma porta: o consumidor deve voltar sem intervenção manual.
    await iniciarBroker(porta);
    const estacaoDepois = await conectarEstacao(porta, UUID_A);

    // O novo broker não guarda a assinatura antiga, então a volta depende da reassinatura.
    await aguardarAssinatura(recebidas, estacaoDepois, "apos-queda");

    expect(warn).toHaveBeenCalledWith("[mqtt] conexão com o broker encerrada");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("assinado pulso/estacoes/+/telemetria"));
  }, 30000);

  test("informa a conexão como desconectada com o broker fora e como ativa quando ele volta", async () => {
    const broker = await iniciarBroker();
    const porta = broker.porta;
    const estado = new MqttStatusService();
    criarConsumidor(porta, [], { estadoConexao: estado }).iniciar();

    await esperar(() => estado.estaConectado());

    await derrubarBroker(broker);
    brokers.splice(brokers.indexOf(broker), 1);
    await esperar(() => !estado.estaConectado());

    await iniciarBroker(porta);
    await esperar(() => estado.estaConectado());
  }, 30000);

  test("continua desconectado enquanto o broker não sobe", async () => {
    // Porta livre sem broker: o cliente fica tentando, sem nunca conectar.
    const semBroker = await iniciarBroker();
    const porta = semBroker.porta;
    await derrubarBroker(semBroker);
    brokers.splice(brokers.indexOf(semBroker), 1);

    const estado = new MqttStatusService();
    criarConsumidor(porta, [], { estadoConexao: estado }).iniciar();
    await new Promise((resolve) => setTimeout(resolve, 1500));

    expect(estado.estaConectado()).toBe(false);

    await iniciarBroker(porta);
    await esperar(() => estado.estaConectado());
  }, 30000);

  test("mensagem que falhou volta pela reconexão e é entregue uma única vez (TASK 14.03)", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    const broker = await iniciarBroker();
    const recebidas: MensagemIngestaoInput[] = [];
    const tentativas: string[] = [];
    let falhasRestantes = 2;

    const consumidor = new ConsumidorMqttTelemetria({
      config: {
        brokerUrl: `mqtt://127.0.0.1:${broker.porta}`,
        usuario: "ingestao-dados",
        senha: "teste",
        qos: 1,
      },
      // Simula o staging fora do ar nas duas primeiras tentativas.
      proximoPasso: async (mensagem) => {
        tentativas.push(mensagem.payloadBruto);
        if (mensagem.payloadBruto === "staging-fora" && falhasRestantes > 0) {
          falhasRestantes -= 1;
          throw new Error("staging indisponível");
        }
        recebidas.push(mensagem);
      },
      reentregaMs: 200,
    });
    consumidores.push(consumidor);
    consumidor.iniciar();

    const estacao = await conectarEstacao(broker.porta, UUID_A);
    await aguardarAssinatura(recebidas, estacao);

    await estacao.publishAsync(topicoDe(UUID_A), "staging-fora", { qos: 1 });
    await esperar(() => recebidas.some((m) => m.payloadBruto === "staging-fora"), 15000);

    expect(tentativas.filter((p) => p === "staging-fora")).toHaveLength(3);
    expect(recebidas.filter((m) => m.payloadBruto === "staging-fora")).toHaveLength(1);
  }, 30000);
});
