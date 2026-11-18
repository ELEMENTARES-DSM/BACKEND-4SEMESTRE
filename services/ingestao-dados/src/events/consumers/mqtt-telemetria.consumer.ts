import mqtt, { type DoneCallback, type IPublishPacket, type MqttClient } from "mqtt";
import { MensagemBruta } from "../../dto/mensagem-ingestao.dto";
import { ConfigMqtt } from "../../config/mqtt.config";
import { TOPICO_ASSINATURA } from "../../utils/topico-estacao";
import {
  receivedMetricsService,
  ReceivedMetricsService,
} from "../../services/received-metrics.service";
import { mqttStatusService, MqttStatusService } from "../../services/mqtt-status.service";

export type ProximoPasso = (mensagem: MensagemBruta) => Promise<unknown>;

export interface OpcoesConsumidorMqtt {
  config: ConfigMqtt;
  proximoPasso: ProximoPasso;
  agora?: () => Date;
  conectar?: typeof mqtt.connect;
  metricasRecebidas?: Pick<ReceivedMetricsService, "incrementar">;
  estadoConexao?: Pick<MqttStatusService, "marcarConectado" | "marcarDesconectado">;
  reentregaMs?: number;
  // Só para os testes de integração que dividem o mesmo broker.
  clientId?: string;
}

// Espera entre a desconexão por falha de gravação e cada tentativa de reconexão (US-40).
export const REENTREGA_PADRAO_MS = 10000;

// clientId fixo: com clean=false, o broker associa a sessão e as mensagens
// pendentes a este identificador. Não pode mudar entre reinicializações.
export const CLIENT_ID = "ingestao-dados";

// MQTT 3.1.1 (protocolVersion 4), como definido na US-11.
const PROTOCOLO_MQTT_3_1_1 = 4;

export class ConsumidorMqttTelemetria {
  private client?: MqttClient;
  private reentregaTimer?: NodeJS.Timeout;
  private encerrando = false;

  constructor(private readonly opcoes: OpcoesConsumidorMqtt) {}

  iniciar(): void {
    this.encerrando = false;
    const { config } = this.opcoes;
    const conectar = this.opcoes.conectar ?? mqtt.connect;
    const estadoConexao = this.opcoes.estadoConexao ?? mqttStatusService;

    this.client = conectar(config.brokerUrl, {
      clientId: this.opcoes.clientId ?? CLIENT_ID,
      protocolVersion: PROTOCOLO_MQTT_3_1_1,
      clean: false,
      // A assinatura é refeita manualmente a cada conexão (ver assinar).
      resubscribe: false,
      username: config.usuario,
      password: config.senha,
    });

    // A reconexão é automática (reconnectPeriod padrão do mqtt.js). A cada
    // conexão, inclusive as reconexões, a assinatura é refeita.
    this.client.on("connect", () => {
      estadoConexao.marcarConectado();
      this.assinar();
    });
    this.client.on("error", (erro) => {
      console.error(`[mqtt] erro de conexão: ${erro.message}`);
    });
    // O mqtt.js emite "close" em toda queda, inclusive antes de cada nova
    // tentativa de reconexão, então o estado fica desconectado até o "connect".
    this.client.on("close", () => {
      estadoConexao.marcarDesconectado();
      console.warn("[mqtt] conexão com o broker encerrada");
    });

    // Confirmação manual: substitui o tratamento padrão de publicações
    // recebidas. O mqtt.js só envia o PUBACK quando este callback é chamado,
    // então a confirmação acontece depois da gravação no Valkey. (A opção
    // customHandleAcks do mqtt.js só vale no MQTT 5; aqui o protocolo é 3.1.1.)
    this.client.handleMessage = (pacote, confirmar) => {
      void this.entregar(pacote, confirmar);
    };
  }

  encerrar(): Promise<void> {
    this.encerrando = true;
    if (this.reentregaTimer) {
      clearTimeout(this.reentregaTimer);
      this.reentregaTimer = undefined;
    }
    if (!this.client) return Promise.resolve();

    return new Promise((resolve) => {
      this.client?.end(false, {}, () => resolve());
    });
  }

  private assinar(): void {
    const { qos } = this.opcoes.config;

    this.client?.subscribe(TOPICO_ASSINATURA, { qos }, (erro) => {
      if (erro) {
        console.error(`[mqtt] falha ao assinar ${TOPICO_ASSINATURA}: ${erro.message}`);
        return;
      }
      console.log(`[mqtt] assinado ${TOPICO_ASSINATURA} com QoS ${qos}`);
    });
  }

  private async entregar(pacote: IPublishPacket, confirmar: DoneCallback): Promise<void> {
    const topico = pacote.topic;
    // Toda mensagem é gravada como chegou, inclusive de tópico fora do padrão:
    // quem decide se ela vale é a verificação, depois da gravação (US-40).
    const mensagem: MensagemBruta = {
      topico,
      payloadBruto: pacote.payload.toString("utf8"),
      recebidoEm: (this.opcoes.agora ?? (() => new Date()))().toISOString(),
    };

    try {
      await this.opcoes.proximoPasso(mensagem);
      // Conta só depois da gravação: se ela falhar, o broker reenvia e a
      // mensagem é contada uma única vez, quando for gravada de fato.
      (this.opcoes.metricasRecebidas ?? receivedMetricsService).incrementar();
      confirmar();
    } catch (erro) {
      // Sem confirmação o broker mantém a mensagem e a reenvia na próxima
      // reconexão da sessão persistente.
      console.error(`[mqtt] falha ao gravar mensagem de ${topico}: ${(erro as Error).message}`);
      confirmar(erro as Error);
      this.agendarReentrega();
    }
  }

  // US-40: com o Valkey fora, desconecta do broker na hora, para não receber
  // mensagens que não podem ser gravadas, e tenta reconectar depois da espera.
  // No MQTT 3.1.1 o broker só reenvia a mensagem sem PUBACK quando a sessão
  // reconecta; se a gravação falhar de novo, o ciclo se repete. Várias falhas
  // seguidas geram uma única desconexão.
  private agendarReentrega(): void {
    const client = this.client;
    if (this.reentregaTimer || this.encerrando || !client) return;

    console.warn("[mqtt] desconectando do broker até o staging voltar a gravar");
    client.end(true, {}, () => undefined);
    this.reentregaTimer = setTimeout(() => {
      this.reentregaTimer = undefined;
      if (this.encerrando) return;
      console.warn("[mqtt] reconectando para receber de novo as mensagens não gravadas");
      client.reconnect();
    }, this.opcoes.reentregaMs ?? REENTREGA_PADRAO_MS);
  }
}
