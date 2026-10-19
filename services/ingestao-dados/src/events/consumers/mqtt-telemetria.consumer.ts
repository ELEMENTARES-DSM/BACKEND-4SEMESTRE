import mqtt, { type DoneCallback, type IPublishPacket, type MqttClient } from "mqtt";
import { MensagemIngestaoInput } from "../../dto/mensagem-ingestao.dto";
import { ConfigMqtt } from "../../config/mqtt.config";
import { extrairEstacaoId, TOPICO_ASSINATURA } from "../../utils/topico-estacao";
import {
  receivedMetricsService,
  ReceivedMetricsService,
} from "../../services/received-metrics.service";
import { mqttStatusService, MqttStatusService } from "../../services/mqtt-status.service";

export type ProximoPasso = (mensagem: MensagemIngestaoInput) => Promise<void>;

export interface OpcoesConsumidorMqtt {
  config: ConfigMqtt;
  proximoPasso: ProximoPasso;
  agora?: () => Date;
  conectar?: typeof mqtt.connect;
  metricasRecebidas?: Pick<ReceivedMetricsService, "incrementar">;
  estadoConexao?: Pick<MqttStatusService, "marcarConectado" | "marcarDesconectado">;
}

// clientId fixo: com clean=false, o broker associa a sessão e as mensagens
// pendentes a este identificador. Não pode mudar entre reinicializações.
export const CLIENT_ID = "ingestao-dados";

// MQTT 3.1.1 (protocolVersion 4), como definido na US-11.
const PROTOCOLO_MQTT_3_1_1 = 4;

export class ConsumidorMqttTelemetria {
  private client?: MqttClient;

  constructor(private readonly opcoes: OpcoesConsumidorMqtt) {}

  iniciar(): void {
    const { config } = this.opcoes;
    const conectar = this.opcoes.conectar ?? mqtt.connect;
    const estadoConexao = this.opcoes.estadoConexao ?? mqttStatusService;

    this.client = conectar(config.brokerUrl, {
      clientId: CLIENT_ID,
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

    // Substitui o tratamento padrão de publicações recebidas. O mqtt.js só
    // envia o PUBACK quando este callback é chamado, então a confirmação
    // acontece depois da entrega ao próximo passo.
    this.client.handleMessage = (pacote, confirmar) => {
      void this.entregar(pacote, confirmar);
    };
  }

  encerrar(): Promise<void> {
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
    const estacaoId = extrairEstacaoId(topico);

    if (!estacaoId) {
      console.warn(`[mqtt] tópico inválido descartado: ${topico}`);
      // Confirma para o broker não reenviar uma mensagem que nunca vai ser aceita.
      confirmar();
      return;
    }

    const mensagem: MensagemIngestaoInput = {
      estacaoId,
      topico,
      payloadBruto: pacote.payload.toString("utf8"),
      recebidoEm: (this.opcoes.agora ?? (() => new Date()))().toISOString(),
    };

    try {
      await this.opcoes.proximoPasso(mensagem);
      // Conta só depois da entrega: se ela falhar, o broker reenvia e a
      // mensagem é contada uma única vez, quando for entregue de fato.
      (this.opcoes.metricasRecebidas ?? receivedMetricsService).incrementar();
      confirmar();
    } catch (erro) {
      // Sem confirmação o broker mantém a mensagem e a reenvia na próxima
      // reconexão da sessão persistente.
      console.error(`[mqtt] falha ao encaminhar mensagem de ${topico}: ${(erro as Error).message}`);
      confirmar(erro as Error);
    }
  }
}
