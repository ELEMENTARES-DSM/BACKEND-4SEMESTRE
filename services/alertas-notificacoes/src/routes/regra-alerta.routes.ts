import { Router } from "express";
import * as regraAlertaController from "../controllers/regra-alerta.controller";
import { validate } from "../middlewares/validate";
import { authMiddleware, checkRole } from "../middlewares/middleware";
import {
  createRegraAlertaSchema,
  updateRegraAlertaStatusSchema,
  regraAlertaIdParamSchema,
} from "../validations/regra-alerta.validation";

const router = Router();

const PAPEIS_PERMITIDOS = ["GESTOR_PUBLICO", "ADMINISTRADOR"];

router.use(authMiddleware, checkRole(PAPEIS_PERMITIDOS));

router.post(
  "/",
  validate(createRegraAlertaSchema),
  regraAlertaController.create
);

router.get("/", regraAlertaController.list);

router.patch(
  "/:id/status",
  validate(regraAlertaIdParamSchema, "params"),
  validate(updateRegraAlertaStatusSchema),
  regraAlertaController.updateStatus
);

export default router;
