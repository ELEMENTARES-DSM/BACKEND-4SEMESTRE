import { EventEmitter } from "events";
import mqtt, { type IPublishPacket } from "mqtt";
import { ConfigMqtt } from "../../../config/mqtt.config";
import { ConsumidorMqttTelemetria, CLIENT_ID } from "../../../events/consumers/mqtt-telemetria.consumer";
import {
  ReceivedMetricsService,
  receivedMetricsService,
} from "../../../services/received-metrics.service";
import { MqttStatusService, mqttStatusService } from "../../../services/mqtt-status.service";

// Unitário: o cliente MQTT é falso e o relógio é injetado.
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
  reconnect = jest.fn(() => this);
}

function pacote(topic: string, payload: string): IPublishPacket {
  return { cmd: "publish", topic, payload: Buffer.from(payload), qos: 1, messageId: 1 } as IPublishPacket;
}

// Simula o broker entregando um pacote: o callback é o que envia o PUBACK.
function entregar(cliente: ClienteFalso, topico: string, payload: string) {
  return new Promise<{ erro?: Error }>((resolve) => {
    cliente.handleMessage(pacote(topico, payload), (erro) => resolve({ erro }));
  });
}

describe("ConsumidorMqttTelemetria", () => {
  let cliente: ClienteFalso;
  let conectar: jest.Mock;
  let gravadas: unknown[];
  let proximoPasso: jest.Mock;
  let recebidas: ReceivedMetricsService;
  let estado: MqttStatusService;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;
  let log: jest.SpyInstance;

  function criarServico(passo?: jest.Mock, reentregaMs?: number) {
    proximoPasso = passo ?? jest.fn(async (mensagem) => {
      gravadas.push(mensagem);
    });
    const servico = new ConsumidorMqttTelemetria({
      config,
      proximoPasso,
      agora: () => dataFixa,
      conectar: conectar as unknown as typeof mqtt.connect,
      metricasRecebidas: recebidas,
      estadoConexao: estado,
      reentregaMs,
    });
    servico.iniciar();
    return servico;
  }

  beforeEach(() => {
    cliente = new ClienteFalso();
    conectar = jest.fn(() => cliente);
    gravadas = [];
    recebidas = new ReceivedMetricsService();
    estado = new MqttStatusService();
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    log = jest.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("US-11 · conexão e assinatura", () => {
    it("deve conectar com clientId fixo, sessão persistente e MQTT 3.1.1 quando inicia", () => {
      // Dado (Arrange)
      // Quando (Act)
      criarServico();

      // Então (Assert)
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

    it("deve assinar pulso/estacoes/+/telemetria com QoS 1 quando conecta", () => {
      // Dado (Arrange)
      criarServico();

      // Quando (Act)
      cliente.emit("connect");

      // Então (Assert)
      expect(cliente.subscribe).toHaveBeenCalledWith("pulso/estacoes/+/telemetria", { qos: 1 }, expect.any(Function));
      expect(log).toHaveBeenCalledWith(expect.stringContaining("pulso/estacoes/+/telemetria"));
    });

    it("deve assinar de novo quando reconecta", () => {
      // Dado (Arrange)
      criarServico();
      cliente.emit("connect");

      // Quando (Act)
      cliente.emit("close");
      cliente.emit("error", new Error("ECONNREFUSED"));
      cliente.emit("connect");

      // Então (Assert)
      expect(cliente.subscribe).toHaveBeenCalledTimes(2);
      expect(cliente.subscribe).toHaveBeenNthCalledWith(2, "pulso/estacoes/+/telemetria", { qos: 1 }, expect.any(Function));
    });

    it("deve registrar o erro sem derrubar o processo quando a conexão falha", () => {
      // Dado (Arrange)
      criarServico();

      // Quando (Act)
      const emitir = () => cliente.emit("error", new Error("ECONNREFUSED"));

      // Então (Assert)
      expect(emitir).not.toThrow();
      expect(error).toHaveBeenCalledWith(expect.stringContaining("ECONNREFUSED"));
    });

    it("deve registrar a falha sem lançar quando a assinatura é negada", () => {
      // Dado (Arrange)
      cliente.subscribe.mockImplementationOnce((_topico, _opcoes, callback) => {
        callback?.(new Error("não autorizado"));
        return cliente;
      });
      criarServico();

      // Quando (Act)
      const emitir = () => cliente.emit("connect");

      // Então (Assert)
      expect(emitir).not.toThrow();
      expect(error).toHaveBeenCalledWith(expect.stringContaining("não autorizado"));
    });

    it("deve desconectar o cliente quando encerra", async () => {
      // Dado (Arrange)
      const servico = criarServico();

      // Quando (Act)
      await servico.encerrar();

      // Então (Assert)
      expect(cliente.end).toHaveBeenCalled();
    });
  });

  describe("US-40 · Cenário 1 · gravação antes de tudo", () => {
    it("deve passar topico, conteúdo e recebidoEm em UTC para a gravação quando a mensagem chega", async () => {
      // Dado (Arrange)
      criarServico();

      // Quando (Act)
      await entregar(cliente, TOPICO_A, '{"timestamp":"2026-10-09T12:00:00Z","leituras":[]}');

      // Então (Assert)
      expect(gravadas).toEqual([
        {
          topico: TOPICO_A,
          payloadBruto: '{"timestamp":"2026-10-09T12:00:00Z","leituras":[]}',
          recebidoEm: "2026-10-09T12:00:00.000Z",
        },
      ]);
    });

    it("deve preservar o conteúdo exatamente como foi publicado quando não é JSON", async () => {
      // Dado (Arrange)
      criarServico();
      const payload = "  texto puro {não é json} ";

      // Quando (Act)
      await entregar(cliente, TOPICO_A, payload);

      // Então (Assert)
      expect(gravadas[0]).toMatchObject({ payloadBruto: payload });
    });

    it("deve gravar e confirmar também quando o tópico está fora do padrão", async () => {
      // Dado (Arrange)
      criarServico();

      // Quando (Act)
      const { erro } = await entregar(cliente, "pulso/estacoes/est-001/telemetria", "{}");

      // Então (Assert)
      expect(erro).toBeUndefined();
      expect(gravadas).toEqual([expect.objectContaining({ topico: "pulso/estacoes/est-001/telemetria" })]);
    });

    it("deve confirmar ao broker só depois quando a gravação ainda não terminou", async () => {
      // Dado (Arrange)
      let concluirGravacao!: () => void;
      const gravacaoLenta = jest.fn(() => new Promise<void>((resolve) => {
        concluirGravacao = resolve;
      }));
      criarServico(gravacaoLenta);
      let confirmou = false;
      const confirmacao = entregar(cliente, TOPICO_A, "{}").then((r) => {
        confirmou = true;
        return r;
      });

      // Quando (Act)
      await Promise.resolve();
      const confirmouAntes = confirmou;
      concluirGravacao();
      const { erro } = await confirmacao;

      // Então (Assert)
      expect(gravacaoLenta).toHaveBeenCalledTimes(1);
      expect(confirmouAntes).toBe(false);
      expect(erro).toBeUndefined();
    });

    it("deve usar o horário atual em UTC no recebidoEm quando não há relógio injetado", async () => {
      // Dado (Arrange)
      const antes = Date.now();
      const passo = jest.fn(async () => undefined);
      new ConsumidorMqttTelemetria({
        config,
        proximoPasso: passo,
        conectar: conectar as unknown as typeof mqtt.connect,
      }).iniciar();

      // Quando (Act)
      await entregar(cliente, TOPICO_A, "{}");

      // Então (Assert)
      const recebidoEm = (passo.mock.calls[0] as unknown as [{ recebidoEm: string }])[0].recebidoEm;
      expect(recebidoEm).toMatch(/Z$/);
      expect(Date.parse(recebidoEm)).toBeGreaterThanOrEqual(antes);
      expect(Date.parse(recebidoEm)).toBeLessThanOrEqual(Date.now());
    });
  });

  describe("US-11 · várias estações ao mesmo tempo", () => {
    it("deve gravar cada mensagem com o seu tópico quando chegam juntas", async () => {
      // Dado (Arrange)
      criarServico();

      // Quando (Act)
      await Promise.all([
        entregar(cliente, TOPICO_A, "a"),
        entregar(cliente, TOPICO_B, "b"),
        entregar(cliente, TOPICO_A, "c"),
      ]);

      // Então (Assert)
      expect(gravadas.map((m) => (m as { topico: string }).topico)).toEqual([TOPICO_A, TOPICO_B, TOPICO_A]);
      expect(gravadas.map((m) => (m as { payloadBruto: string }).payloadBruto)).toEqual(["a", "b", "c"]);
    });

    it("deve confirmar cada mensagem individualmente quando uma delas falha", async () => {
      // Dado (Arrange)
      criarServico(
        jest.fn()
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error("falhou"))
          .mockResolvedValueOnce(undefined),
      );

      // Quando (Act)
      const resultados = await Promise.all([
        entregar(cliente, TOPICO_A, "1"),
        entregar(cliente, TOPICO_B, "2"),
        entregar(cliente, TOPICO_A, "3"),
      ]);

      // Então (Assert)
      expect(resultados.map((r) => r.erro?.message)).toEqual([undefined, "falhou", undefined]);
    });

    it("deve gravar duas vezes quando a mesma mensagem chega duas vezes", async () => {
      // Dado (Arrange)
      criarServico();
      const payload = '{"timestamp":"2026-10-09T12:00:00Z","leituras":[]}';

      // Quando (Act)
      await entregar(cliente, TOPICO_A, payload);
      await entregar(cliente, TOPICO_A, payload);

      // Então (Assert)
      expect(gravadas).toHaveLength(2);
      expect(gravadas[0]).toEqual(gravadas[1]);
    });
  });

  describe("US-11 · estado da conexão", () => {
    it("deve ficar desconectado quando o broker não responde", () => {
      // Dado (Arrange)
      criarServico();

      // Quando (Act)
      cliente.emit("error", new Error("ECONNREFUSED"));

      // Então (Assert)
      expect(estado.estaConectado()).toBe(false);
    });

    it("deve ficar conectado quando conecta no broker", () => {
      // Dado (Arrange)
      criarServico();

      // Quando (Act)
      cliente.emit("connect");

      // Então (Assert)
      expect(estado.estaConectado()).toBe(true);
    });

    it("deve voltar a conectado quando a conexão cai e reconecta", () => {
      // Dado (Arrange)
      criarServico();
      cliente.emit("connect");

      // Quando (Act)
      cliente.emit("close");
      const durante = estado.estaConectado();
      cliente.emit("connect");

      // Então (Assert)
      expect(durante).toBe(false);
      expect(estado.estaConectado()).toBe(true);
    });
  });

  describe("US-11 · contador de leituras recebidas", () => {
    it("deve somar 1 quando a mensagem é gravada", async () => {
      // Dado (Arrange)
      criarServico();

      // Quando (Act)
      await entregar(cliente, TOPICO_A, "{}");

      // Então (Assert)
      expect(recebidas.obterTotal()).toBe(1);
    });

    it("deve somar uma por mensagem quando várias estações publicam ao mesmo tempo", async () => {
      // Dado (Arrange)
      criarServico();

      // Quando (Act)
      await Promise.all([
        entregar(cliente, TOPICO_A, "a"),
        entregar(cliente, TOPICO_B, "b"),
        entregar(cliente, TOPICO_A, "c"),
      ]);

      // Então (Assert)
      expect(recebidas.obterTotal()).toBe(3);
    });

    it("deve contar quando o payload é malformado", async () => {
      // Dado (Arrange)
      criarServico();

      // Quando (Act)
      await entregar(cliente, TOPICO_A, "não é json");

      // Então (Assert)
      expect(recebidas.obterTotal()).toBe(1);
    });

    it("deve contar duas vezes quando a mesma mensagem é gravada duas vezes", async () => {
      // Dado (Arrange)
      criarServico();

      // Quando (Act)
      await entregar(cliente, TOPICO_A, "{}");
      await entregar(cliente, TOPICO_A, "{}");

      // Então (Assert)
      expect(recebidas.obterTotal()).toBe(2);
    });

    it("deve contar quando o tópico está fora do padrão, porque ela é gravada e depois recusada", async () => {
      // Dado (Arrange)
      criarServico();

      // Quando (Act)
      await entregar(cliente, "pulso/estacoes/telemetria", "{}");

      // Então (Assert)
      expect(recebidas.obterTotal()).toBe(1);
    });

    it("deve contar só quando o reenvio é gravado se a primeira gravação falha", async () => {
      // Dado (Arrange)
      criarServico(jest.fn().mockRejectedValueOnce(new Error("falhou")).mockResolvedValueOnce(undefined));

      // Quando (Act)
      await entregar(cliente, TOPICO_A, "{}");
      const depoisDaFalha = recebidas.obterTotal();
      await entregar(cliente, TOPICO_A, "{}");

      // Então (Assert)
      expect(depoisDaFalha).toBe(0);
      expect(recebidas.obterTotal()).toBe(1);
    });

    it("deve usar os globais lidos pelas rotas quando contador e estado não são injetados", async () => {
      // Dado (Arrange)
      receivedMetricsService.reset();
      mqttStatusService.marcarDesconectado();
      new ConsumidorMqttTelemetria({
        config,
        proximoPasso: async () => undefined,
        conectar: conectar as unknown as typeof mqtt.connect,
      }).iniciar();

      // Quando (Act)
      cliente.emit("connect");
      await entregar(cliente, TOPICO_A, "{}");

      // Então (Assert)
      expect(mqttStatusService.estaConectado()).toBe(true);
      expect(receivedMetricsService.obterTotal()).toBe(1);
    });
  });

  describe("US-40 · Cenário 6 · Valkey parado", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("deve não confirmar e registrar o erro quando o Valkey não grava", async () => {
      // Dado (Arrange)
      criarServico(jest.fn().mockRejectedValue(new Error("Valkey indisponível")));

      // Quando (Act)
      const { erro } = await entregar(cliente, TOPICO_A, "{}");

      // Então (Assert)
      expect(erro).toEqual(new Error("Valkey indisponível"));
      expect(error).toHaveBeenCalledWith(expect.stringContaining("Valkey indisponível"));
      expect(recebidas.obterTotal()).toBe(0);
    });

    it("deve desconectar do broker na hora quando o Valkey não grava", async () => {
      // Dado (Arrange)
      criarServico(jest.fn().mockRejectedValue(new Error("Valkey indisponível")));

      // Quando (Act)
      await entregar(cliente, TOPICO_A, "{}");

      // Então (Assert)
      expect(cliente.end).toHaveBeenCalledWith(true, {}, expect.any(Function));
      expect(cliente.reconnect).not.toHaveBeenCalled();
    });

    it("deve reconectar depois de 10 s quando a espera não é configurada", async () => {
      // Dado (Arrange)
      criarServico(jest.fn().mockRejectedValue(new Error("Valkey indisponível")));
      await entregar(cliente, TOPICO_A, "{}");

      // Quando (Act)
      jest.advanceTimersByTime(9999);
      const antes = cliente.reconnect.mock.calls.length;
      jest.advanceTimersByTime(1);

      // Então (Assert)
      expect(antes).toBe(0);
      expect(cliente.reconnect).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("reconectando"));
    });

    it("deve desconectar uma única vez quando várias gravações falham seguidas", async () => {
      // Dado (Arrange)
      criarServico(jest.fn().mockRejectedValue(new Error("Valkey indisponível")), 1000);

      // Quando (Act)
      await entregar(cliente, TOPICO_A, "{}");
      await entregar(cliente, TOPICO_B, "{}");
      await entregar(cliente, TOPICO_A, "{}");
      jest.advanceTimersByTime(1000);

      // Então (Assert)
      expect(cliente.end).toHaveBeenCalledTimes(1);
      expect(cliente.reconnect).toHaveBeenCalledTimes(1);
    });

    it("deve desconectar e reconectar de novo quando a gravação volta a falhar depois da reconexão", async () => {
      // Dado (Arrange)
      criarServico(jest.fn().mockRejectedValue(new Error("Valkey indisponível")), 1000);
      await entregar(cliente, TOPICO_A, "{}");
      jest.advanceTimersByTime(1000);

      // Quando (Act)
      await entregar(cliente, TOPICO_A, "{}");
      jest.advanceTimersByTime(1000);

      // Então (Assert)
      expect(cliente.end).toHaveBeenCalledTimes(2);
      expect(cliente.reconnect).toHaveBeenCalledTimes(2);
    });

    it("deve não desconectar quando a gravação funciona", async () => {
      // Dado (Arrange)
      criarServico(undefined, 1000);

      // Quando (Act)
      await entregar(cliente, TOPICO_A, "{}");
      jest.advanceTimersByTime(20000);

      // Então (Assert)
      expect(cliente.end).not.toHaveBeenCalled();
      expect(cliente.reconnect).not.toHaveBeenCalled();
    });

    it("deve cancelar a reconexão agendada quando o serviço encerra", async () => {
      // Dado (Arrange)
      const servico = criarServico(jest.fn().mockRejectedValue(new Error("Valkey indisponível")), 1000);
      await entregar(cliente, TOPICO_A, "{}");

      // Quando (Act)
      await servico.encerrar();
      jest.advanceTimersByTime(1000);

      // Então (Assert)
      expect(cliente.reconnect).not.toHaveBeenCalled();
    });
  });
});
