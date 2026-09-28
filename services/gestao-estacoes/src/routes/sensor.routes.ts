import { Router } from "express";
import * as sensorController from "../controllers/sensor.controller";
import { validate } from "../middlewares/validate";
import { authMiddleware, checkRole } from "../middlewares/middleware";
import {
  createSensorSchema,
  updateSensorSchema,
  updateSensorStatusSchema,
  estacaoIdParamSchema,
  sensorIdParamSchema,
} from "../validations/sensor.validation";

const router = Router();

const PAPEIS_PERMITIDOS = ["GESTOR_PUBLICO", "ADMINISTRADOR"];

router.use(authMiddleware);

router.post(
  "/estacoes/:estacaoId/sensores",
  checkRole(PAPEIS_PERMITIDOS),
  validate(estacaoIdParamSchema, "params"),
  validate(createSensorSchema),
  sensorController.create
);

router.get(
  "/estacoes/:estacaoId/sensores",
  validate(estacaoIdParamSchema, "params"),
  sensorController.listByEstacao
);

router.put(
  "/sensores/:id",
  checkRole(PAPEIS_PERMITIDOS),
  validate(sensorIdParamSchema, "params"),
  validate(updateSensorSchema),
  sensorController.update
);

router.patch(
  "/sensores/:id/status",
  checkRole(PAPEIS_PERMITIDOS),
  validate(sensorIdParamSchema, "params"),
  validate(updateSensorStatusSchema),
  sensorController.updateStatus
);

export default router;
