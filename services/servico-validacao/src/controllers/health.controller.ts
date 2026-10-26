import { Request, Response } from "express";
import { verificarConexaoBanco } from "../config/db";
import { obterEstadoSaudeConsumidor } from "../events/consumers/rabbitmq-telemetria.consumer";

export const obterSaude = async (_req: Request, res: Response): Promise<void> => {
  const postgresConectado = await verificarConexaoBanco();
  const estadoRabbit = obterEstadoSaudeConsumidor();

  const saudavel =
    postgresConectado &&
    estadoRabbit.rabbitmq === "conectado" &&
    estadoRabbit.fila === "disponivel";

  res.status(saudavel ? 200 : 503).json({
    status: saudavel ? "ok" : "indisponivel",
    conexoes: {
      postgres: postgresConectado ? "conectado" : "desconectado",
      rabbitmq: estadoRabbit.rabbitmq,
    },
    fila: estadoRabbit.fila,
  });
};

export default {
  obterSaude,
};
