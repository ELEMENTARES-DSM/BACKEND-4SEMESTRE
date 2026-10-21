import { Request, Response } from "express";
import { mqttStatusService } from "../services/mqtt-status.service";
import { rabbitMqConectado } from "../services/staging-publisher.service";

export const obterSaude = (_req: Request, res: Response): void => {
  const mqttConectado = mqttStatusService.estaConectado();
  const rabbitmqConectado = rabbitMqConectado();
  const conectado = mqttConectado && rabbitmqConectado;

  res.status(conectado ? 200 : 503).json({
    status: conectado ? "ok" : "indisponivel",
    conexoes: {
      mqtt: mqttConectado ? "conectado" : "desconectado",
      rabbitmq: rabbitmqConectado ? "conectado" : "desconectado",
    },
  });
};

export default {
  obterSaude,
};
