import { Router } from "express";
import * as estacaoController from "../controllers/estacao.controller";
import * as sensorController from "../controllers/sensor.controller";
import { internalTokenMiddleware } from "../middlewares/middleware";
import { validate } from "../middlewares/validate";
import { estacaoUuidParamSchema } from "../validations/estacao.validation";

const router = Router();

router.use(internalTokenMiddleware);

router.patch(
  "/:uuid/inativar",
  validate(estacaoUuidParamSchema, "params"),
  estacaoController.inativarInterno,
);

// Usada pelo simulador de estações: sensores da estação com a faixa do catálogo.
router.get(
  "/:uuid/sensores",
  validate(estacaoUuidParamSchema, "params"),
  sensorController.listarInterno,
);

export default router;
