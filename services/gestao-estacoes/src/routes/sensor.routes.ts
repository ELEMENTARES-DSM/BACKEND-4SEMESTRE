import { Router } from "express";
import * as sensorController from "../controllers/sensor.controller";
import { validate } from "../middlewares/validate";
import { authMiddleware, checkRole } from "../middlewares/middleware";
import {
  createSensorSchema,
  updateSensorStatusSchema,
  estacaoIdParamSchema,
  sensorIdParamSchema,
} from "../validations/sensor.validation";

const router = Router();

const PAPEIS_PERMITIDOS = ["GESTOR_PUBLICO", "ADMINISTRADOR"];

router.use(authMiddleware, checkRole(PAPEIS_PERMITIDOS));

router.post(
  "/estacoes/:estacaoId/sensores",
  validate(estacaoIdParamSchema, "params"),
  validate(createSensorSchema),
  sensorController.create
);

router.get(
  "/estacoes/:estacaoId/sensores",
  validate(estacaoIdParamSchema, "params"),
  sensorController.listByEstacao
);

router.patch(
  "/sensores/:id/status",
  validate(sensorIdParamSchema, "params"),
  validate(updateSensorStatusSchema),
  sensorController.updateStatus
);

export default router;