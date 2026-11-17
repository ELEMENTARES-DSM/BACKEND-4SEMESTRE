import { Router } from "express";
import * as tipoSensorController from "../controllers/tipo-sensor.controller";
import { validate } from "../middlewares/validate";
import { authMiddleware, checkRole } from "../middlewares/middleware";
import {
  createTipoSensorSchema,
  tipoSensorIdParamSchema,
  updateTipoSensorSchema,
} from "../validations/tipo-sensor.validation";

const router = Router();

// Montado antes de estacao.routes: GET /estacoes/:id capturaria "tipos-sensor".
// A autenticação fica por rota para não interceptar as demais rotas de /estacoes.
router.get("/tipos-sensor", authMiddleware, tipoSensorController.listar);

router.post(
  "/tipos-sensor",
  authMiddleware,
  checkRole(["ADMINISTRADOR"]),
  validate(createTipoSensorSchema),
  tipoSensorController.criar
);

router.put(
  "/tipos-sensor/:id",
  authMiddleware,
  checkRole(["ADMINISTRADOR"]),
  validate(tipoSensorIdParamSchema, "params"),
  validate(updateTipoSensorSchema),
  tipoSensorController.atualizar
);

router.delete(
  "/tipos-sensor/:id",
  authMiddleware,
  checkRole(["ADMINISTRADOR"]),
  validate(tipoSensorIdParamSchema, "params"),
  tipoSensorController.excluir
);

export default router;
