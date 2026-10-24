import { Request, Response } from "express";
import {
  RabbitMqIndisponivelError,
  reenviarEventosDlq,
} from "../services/reenvio-dlq.service";
import {
  QUANTIDADE_INVALIDA,
  reenvioDlqSchema,
} from "../validations/reenvio-dlq.validation";
import logger from "../utils/logger";

// Só um reenvio por vez em cada instância do serviço (US-20).
let reenvioEmAndamento = false;

export const reenviarDlq = async (req: Request, res: Response): Promise<void> => {
  const validacao = reenvioDlqSchema.safeParse(req.body ?? {});
  if (!validacao.success) {
    res.status(400).json({ erro: QUANTIDADE_INVALIDA });
    return;
  }

  if (reenvioEmAndamento) {
    res.status(409).json({ erro: "Reenvio já em andamento" });
    return;
  }

  const { quantidade } = validacao.data;
  const registro = {
    usuario: req.usuario?.id,
    horario: new Date().toISOString(),
    quantidadeSolicitada: quantidade ?? "todos",
  };

  reenvioEmAndamento = true;
  try {
    const resultado = await reenviarEventosDlq(quantidade);
    logger.info("Reenvio da DLQ concluído", { ...registro, ...resultado });
    res.status(200).json(resultado);
  } catch (erro) {
    if (erro instanceof RabbitMqIndisponivelError) {
      logger.error("Reenvio da DLQ interrompido: RabbitMQ indisponível", {
        ...registro,
        reenviados: erro.reenviados,
      });
      res.status(503).json({ erro: "RabbitMQ indisponível" });
      return;
    }
    throw erro;
  } finally {
    reenvioEmAndamento = false;
  }
};

export default {
  reenviarDlq,
};
