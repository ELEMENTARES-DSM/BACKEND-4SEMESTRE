import app from "./app";
import { carregarConfigMqtt } from "./config/mqtt.config";
import { ConsumidorMqttTelemetria, ProximoPasso } from "./events/consumers/mqtt-telemetria.consumer";

const PORT = process.env.PORT || 3005;

// Provisório até a US-12: o próximo passo ainda não existe, então a mensagem só é registrada.
const encaminharProximoPasso: ProximoPasso = async (mensagem) => {
  console.log(`[ingestao] mensagem de ${mensagem.estacaoId} recebida em ${mensagem.recebidoEm}`);
};

const clienteMqtt = new ConsumidorMqttTelemetria({
  config: carregarConfigMqtt(),
  proximoPasso: encaminharProximoPasso,
});

app.listen(PORT, () => {
  console.log(`ingestao-dados running on port ${PORT}`);
});

clienteMqtt.iniciar();

const encerrar = async () => {
  await clienteMqtt.encerrar();
  process.exit(0);
};

process.on("SIGTERM", encerrar);
process.on("SIGINT", encerrar);