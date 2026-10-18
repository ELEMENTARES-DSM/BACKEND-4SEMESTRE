import { Request, Response } from "express";
import { mqttStatusService } from "../services/mqtt-status.service";

// Sem o broker MQTT o serviço não recebe leituras, então responde 503
// enquanto a conexão estiver caída (US-11, cenários 6 e 8).
export const obterSaude = (_req: Request, res: Response): void => {
  const mqttConectado = mqttStatusService.estaConectado();

  res.status(mqttConectado ? 200 : 503).json({
    status: mqttConectado ? "ok" : "indisponivel",
    conexoes: {
      mqtt: mqttConectado ? "conectado" : "desconectado",
    },
  });
};

export default {
  obterSaude,
};
