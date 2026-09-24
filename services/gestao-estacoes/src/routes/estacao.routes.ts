import { Router } from "express";
import * as estacaoController from "../controllers/estacao.controller";
import { authenticate, authorize } from "../middlewares/auth";
import { validate } from "../middlewares/validate";
import {
  createEstacaoSchema,
  updateEstacaoSchema,
  estacaoIdParamSchema,
  updateStatusSchema,
} from "../validations/estacao.validation";
import { authMiddleware } from "../middlewares/middleware";

const router = Router();


router.get("/estacoes/status", authMiddleware, estacaoController.status);

router.use(authenticate);

router.get(
  "/",
  authorize("ADMINISTRADOR", "GESTOR_PUBLICO"),
  estacaoController.findAll,
);

router.get(
  "/:id",
  authorize("ADMINISTRADOR", "GESTOR_PUBLICO"),
  validate(estacaoIdParamSchema, "params"),
  estacaoController.findById,
);

router.post(
  "/",
  authorize("ADMINISTRADOR", "GESTOR_PUBLICO"),
  validate(createEstacaoSchema, "body"),
  estacaoController.create,
);

router.put(
  "/:id",
  authorize("ADMINISTRADOR", "GESTOR_PUBLICO"),
  validate(estacaoIdParamSchema, "params"),
  validate(updateEstacaoSchema, "body"),
  estacaoController.update,
);

router.patch(
  "/:id/status",
  authorize("ADMINISTRADOR", "GESTOR_PUBLICO"),
  validate(estacaoIdParamSchema, "params"),
  validate(updateStatusSchema, "body"),
  estacaoController.updateStatus,
);

export default router;