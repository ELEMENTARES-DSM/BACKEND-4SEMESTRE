import { EventEmitter } from "events";
import mqtt, { type IPublishPacket } from "mqtt";
import { ConfigMqtt } from "../../../config/mqtt.config";
import { ConsumidorMqttTelemetria, CLIENT_ID } from "../../../events/consumers/mqtt-telemetria.consumer";
import {
  ReceivedMetricsService,
  receivedMetricsService,
} from "../../../services/received-metrics.service";
import { MqttStatusService, mqttStatusService } from "../../../services/mqtt-status.service";

const UUID_A = "8723c462-e79c-4e58-9751-eef8868a5312";
const UUID_B = "e30a57e3-0d33-4f9e-86b2-6cb1690a7891";
const TOPICO_A = `pulso/estacoes/${UUID_A}/telemetria`;
const TOPICO_B = `pulso/estacoes/${UUID_B}/telemetria`;

const config: ConfigMqtt = {
  brokerUrl: "mqtt://mosquitto:1883",
  usuario: "ingestao-dados",
  senha: "segredo",
  qos: 1,
};

const dataFixa = new Date("2026-10-09T12:00:00.000Z");

class ClienteFalso extends EventEmitter {
  subscribe = jest.fn((_topico: string, _opcoes: unknown, callback?: (erro: Error | null) => void) => {
    callback?.(null);
    return this;
  });
  end = jest.fn((_force: boolean, _opcoes: unknown, callback?: () => void) => {
    callback?.();
    return this;
  });
  handleMessage = jest.fn((_pacote: IPublishPacket, callback: (erro?: Error) => void) => callback());
}

function pacote(topic: string, payload: string): IPublishPacket {
  return { cmd: "publish", topic, payload: Buffer.from(payload), qos: 1, messageId: 1 } as IPublishPacket;
}

// Simula o broker entregando um pacote ao cliente, como o mqtt.js faz internamente.
function entregar(cliente: ClienteFalso, topico: string, payload: string) {
  return new Promise<{ erro?: Error }>((resolve) => {
    cliente.handleMessage(pacote(topico, payload), (erro) => resolve({ erro }));
  });
}

describe("ConsumidorMqttTelemetria", () => {
  let cliente: ClienteFalso;
  let conectar: jest.Mock;
  let encaminhados: unknown[];
  let proximoPasso: jest.Mock;
  let recebidas: ReceivedMetricsService;
  let estado: MqttStatusService;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;
  let log: jest.SpyInstance;

  function criarServico(passo?: jest.Mock) {
    proximoPasso = passo ?? jest.fn(async (mensagem) => {
      encaminhados.push(mensagem);
    });
    const servico = new ConsumidorMqttTelemetria({
      config,
      proximoPasso,
      agora: () => dataFixa,
      conectar: conectar as unknown as typeof mqtt.connect,
      metricasRecebidas: recebidas,
      estadoConexao: estado,
    });
    servico.iniciar();
    return servico;
  }

  beforeEach(() => {
    cliente = new ClienteFalso();
    conectar = jest.fn(() => cliente);
    encaminhados = [];
    recebidas = new ReceivedMetricsService();
    estado = new MqttStatusService();
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    log = jest.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("conexão e assinatura", () => {
    test("conecta com clientId fixo, sessão persistente e MQTT 3.1.1", () => {
      criarServico();

      expect(conectar).toHaveBeenCalledWith(
        "mqtt://mosquitto:1883",
        expect.objectContaining({
          clientId: CLIENT_ID,
          clean: false,
          protocolVersion: 4,
          username: "ingestao-dados",
          password: "segredo",
        }),
      );
    });

    test("assina pulso/estacoes/+/telemetria com QoS 1 ao conectar", () => {
      criarServico();
      cliente.emit("connect");

      expect(cliente.subscribe).toHaveBeenCalledWith(
        "pulso/estacoes/+/telemetria",
        { qos: 1 },
        expect.any(Function),
      );
    });

    test("assina de novo a cada reconexão", () => {
      criarServico();
      cliente.emit("connect");
      cliente.emit("close");
      cliente.emit("error", new Error("ECONNREFUSED"));
      cliente.emit("connect");

      expect(cliente.subscribe).toHaveBeenCalledTimes(2);
      expect(cliente.subscribe).toHaveBeenNthCalledWith(
        2,
        "pulso/estacoes/+/telemetria",
        { qos: 1 },
        expect.any(Function),
      );
    });

    test("erro de conexão é registrado sem derrubar o processo", () => {
      criarServico();

      expect(() => cliente.emit("error", new Error("ECONNREFUSED"))).not.toThrow();
      expect(error).toHaveBeenCalledWith(expect.stringContaining("ECONNREFUSED"));
    });

    test("registra falha de assinatura sem lançar exceção", () => {
      cliente.subscribe.mockImplementationOnce((_topico, _opcoes, callback) => {
        callback?.(new Error("não autorizado"));
        return cliente;
      });
      criarServico();

      expect(() => cliente.emit("connect")).not.toThrow();
      expect(error).toHaveBeenCalledWith(expect.stringContaining("não autorizado"));
    });

    test("encerrar desconecta o cliente", async () => {
      const servico = criarServico();
      await servico.encerrar();

      expect(cliente.end).toHaveBeenCalled();
    });
  });

  describe("recebimento", () => {
    test("entrega a mensagem com estacaoId, topico, payloadBruto e recebidoEm em UTC", async () => {
      criarServico();
      await entregar(cliente, TOPICO_A, '{"timestamp":"2026-10-09T12:00:00Z","leituras":[]}');

      expect(encaminhados).toEqual([
        {
          estacaoId: UUID_A,
          topico: TOPICO_A,
          payloadBruto: '{"timestamp":"2026-10-09T12:00:00Z","leituras":[]}',
          recebidoEm: "2026-10-09T12:00:00.000Z",
        },
      ]);
    });

    test("preserva o payload exatamente como foi publicado, mesmo sem ser JSON", async () => {
      criarServico();
      const payload = "  texto puro {não é json} ";
      await entregar(cliente, TOPICO_A, payload);

      expect(encaminhados[0]).toMatchObject({ payloadBruto: payload });
    });

    test("confirma a mensagem somente depois de a entrega terminar", async () => {
      let concluirEntrega!: () => void;
      const passoLento = jest.fn(
        () => new Promise<void>((resolve) => {
          concluirEntrega = resolve;
        }),
      );
      criarServico(passoLento);

      const confirmacao = entregar(cliente, TOPICO_A, "{}");
      await Promise.resolve();
      expect(passoLento).toHaveBeenCalledTimes(1);

      concluirEntrega();
      const { erro } = await confirmacao;
      expect(erro).toBeUndefined();
    });

    test("falha na entrega não confirma a mensagem", async () => {
      criarServico(jest.fn().mockRejectedValue(new Error("próximo passo indisponível")));

      const { erro } = await entregar(cliente, TOPICO_A, "{}");

      expect(erro).toEqual(new Error("próximo passo indisponível"));
      expect(error).toHaveBeenCalledWith(expect.stringContaining("próximo passo indisponível"));
    });
  });

  describe("concorrência", () => {
    test("identifica corretamente a estação de cada tópico quando chegam juntas", async () => {
      criarServico();

      await Promise.all([
        entregar(cliente, TOPICO_A, "a"),
        entregar(cliente, TOPICO_B, "b"),
        entregar(cliente, TOPICO_A, "c"),
      ]);

      expect(encaminhados.map((m) => (m as { estacaoId: string }).estacaoId)).toEqual([
        UUID_A,
        UUID_B,
        UUID_A,
      ]);
      expect(encaminhados.map((m) => (m as { payloadBruto: string }).payloadBruto)).toEqual([
        "a",
        "b",
        "c",
      ]);
    });

    test("cada mensagem é confirmada individualmente, mesmo quando uma falha", async () => {
      criarServico(
        jest
          .fn()
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error("falhou"))
          .mockResolvedValueOnce(undefined),
      );

      const resultados = await Promise.all([
        entregar(cliente, TOPICO_A, "1"),
        entregar(cliente, TOPICO_B, "2"),
        entregar(cliente, TOPICO_A, "3"),
      ]);

      expect(resultados.map((r) => r.erro?.message)).toEqual([undefined, "falhou", undefined]);
    });
  });

  describe("duplicatas", () => {
    test("a mesma mensagem recebida duas vezes é entregue duas vezes", async () => {
      criarServico();
      const payload = '{"timestamp":"2026-10-09T12:00:00Z","leituras":[]}';

      await entregar(cliente, TOPICO_A, payload);
      await entregar(cliente, TOPICO_A, payload);

      expect(encaminhados).toHaveLength(2);
      expect(encaminhados[0]).toEqual(encaminhados[1]);
    });
  });

  describe("tópicos inválidos", () => {
    test("tópico sem UUID não é entregue ao fluxo e é registrado com o tópico recebido", async () => {
      criarServico();

      const { erro } = await entregar(cliente, "pulso/estacoes/est-001/telemetria", "{}");

      expect(proximoPasso).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("pulso/estacoes/est-001/telemetria"));
      expect(erro).toBeUndefined();
    });

    test("tópico inválido é confirmado para o broker não reenviá-lo", async () => {
      criarServico();

      const { erro } = await entregar(cliente, "pulso/estacoes/telemetria", "{}");

      expect(erro).toBeUndefined();
      expect(encaminhados).toHaveLength(0);
    });
  });

  test("sem relógio injetado, usa o horário atual em UTC no recebidoEm", async () => {
    const antes = Date.now();
    const recebidas: unknown[] = [];
    const servico = new ConsumidorMqttTelemetria({
      config,
      proximoPasso: async (m) => {
        recebidas.push(m);
      },
      conectar: conectar as unknown as typeof mqtt.connect,
    });
    servico.iniciar();

    await entregar(cliente, TOPICO_A, "{}");

    const recebidoEm = (recebidas[0] as { recebidoEm: string }).recebidoEm;
    expect(recebidoEm).toMatch(/Z$/);
    expect(Date.parse(recebidoEm)).toBeGreaterThanOrEqual(antes);
    expect(Date.parse(recebidoEm)).toBeLessThanOrEqual(Date.now());
  });

  describe("estado da conexão", () => {
    test("começa desconectado enquanto o broker não responde", () => {
      criarServico();
      cliente.emit("error", new Error("ECONNREFUSED"));

      expect(estado.estaConectado()).toBe(false);
    });

    test("fica conectado ao conectar no broker", () => {
      criarServico();
      cliente.emit("connect");

      expect(estado.estaConectado()).toBe(true);
    });

    test("fica desconectado quando a conexão cai e volta a conectado na reconexão", () => {
      criarServico();
      cliente.emit("connect");

      cliente.emit("close");
      expect(estado.estaConectado()).toBe(false);

      cliente.emit("connect");
      expect(estado.estaConectado()).toBe(true);
    });
  });

  describe("contador de leituras recebidas", () => {
    test("soma 1 a cada mensagem entregue", async () => {
      criarServico();
      await entregar(cliente, TOPICO_A, "{}");

      expect(recebidas.obterTotal()).toBe(1);
    });

    test("soma uma por estação quando várias publicam ao mesmo tempo", async () => {
      criarServico();

      await Promise.all([
        entregar(cliente, TOPICO_A, "a"),
        entregar(cliente, TOPICO_B, "b"),
        entregar(cliente, TOPICO_A, "c"),
      ]);

      expect(recebidas.obterTotal()).toBe(3);
    });

    test("payload malformado também conta como recebido", async () => {
      criarServico();
      await entregar(cliente, TOPICO_A, "não é json");

      expect(recebidas.obterTotal()).toBe(1);
    });

    test("a mesma mensagem entregue duas vezes conta duas vezes", async () => {
      criarServico();
      await entregar(cliente, TOPICO_A, "{}");
      await entregar(cliente, TOPICO_A, "{}");

      expect(recebidas.obterTotal()).toBe(2);
    });

    test("tópico fora do padrão não conta", async () => {
      criarServico();
      await entregar(cliente, "pulso/estacoes/telemetria", "{}");

      expect(recebidas.obterTotal()).toBe(0);
    });

    test("falha na entrega não conta; a mensagem conta quando o reenvio é entregue", async () => {
      criarServico(
        jest.fn().mockRejectedValueOnce(new Error("falhou")).mockResolvedValueOnce(undefined),
      );

      await entregar(cliente, TOPICO_A, "{}");
      expect(recebidas.obterTotal()).toBe(0);

      await entregar(cliente, TOPICO_A, "{}");
      expect(recebidas.obterTotal()).toBe(1);
    });
  });

  test("sem contador e estado injetados, usa os globais lidos pelas rotas", async () => {
    receivedMetricsService.reset();
    mqttStatusService.marcarDesconectado();
    const servico = new ConsumidorMqttTelemetria({
      config,
      proximoPasso: async () => undefined,
      conectar: conectar as unknown as typeof mqtt.connect,
    });
    servico.iniciar();

    cliente.emit("connect");
    await entregar(cliente, TOPICO_A, "{}");

    expect(mqttStatusService.estaConectado()).toBe(true);
    expect(receivedMetricsService.obterTotal()).toBe(1);
  });

  test("assinatura inicial registra o tópico e o QoS no log", () => {
    criarServico();
    cliente.emit("connect");

    expect(log).toHaveBeenCalledWith(expect.stringContaining("pulso/estacoes/+/telemetria"));
  });
});
