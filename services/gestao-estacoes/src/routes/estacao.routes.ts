import { Router } from "express";
import * as estacaoController from "../controllers/estacao.controller";
import { authMiddleware, checkRole } from "../middlewares/middleware"; 
import { validate } from "../middlewares/validate";
import {
  createEstacaoSchema,
  updateEstacaoSchema,
  estacaoIdParamSchema,
  updateStatusSchema,
} from "../validations/estacao.validation";

const router = Router();

router.use(authMiddleware);

router.get(
  "/status",
  checkRole(["ADMINISTRADOR", "GESTOR_PUBLICO"]),
  estacaoController.status
);

router.get(
  "/",
  checkRole(["ADMINISTRADOR", "GESTOR_PUBLICO"]), // <- Usa o checkRole
  estacaoController.findAll,
);

router.get(
  "/:id",
  checkRole(["ADMINISTRADOR", "GESTOR_PUBLICO"]),
  validate(estacaoIdParamSchema, "params"),
  estacaoController.findById,
);

router.post(
  "/",
  checkRole(["ADMINISTRADOR", "GESTOR_PUBLICO"]),
  validate(createEstacaoSchema, "body"),
  estacaoController.create,
);

router.put(
  "/:id",
  checkRole(["ADMINISTRADOR", "GESTOR_PUBLICO"]),
  validate(estacaoIdParamSchema, "params"),
  validate(updateEstacaoSchema, "body"),
  estacaoController.update,
);

router.patch(
  "/:id/status",
  checkRole(["ADMINISTRADOR", "GESTOR_PUBLICO"]),
  validate(estacaoIdParamSchema, "params"),
  validate(updateStatusSchema, "body"),
  estacaoController.updateStatus,
);

export default router;