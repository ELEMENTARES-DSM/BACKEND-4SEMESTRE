import { Router } from "express";
import * as estacaoController from "../controllers/estacao.controller";
import { authenticate, authorize } from "../middlewares/auth";
import { validate } from "../middlewares/validate";
import {
  createEstacaoSchema,
  updateEstacaoSchema,
  estacaoIdParamSchema,
} from "../validations/estacao.validation";

const router = Router();

router.use(authenticate);

router.get(
  "/",
  authorize("ADMINISTRADOR", "GESTOR_PUBLICO"),
  estacaoController.findAll
);

router.post(
  "/",
  authorize("ADMINISTRADOR", "GESTOR_PUBLICO"),
  validate(createEstacaoSchema, "body"),
  estacaoController.create
);

router.put(
  "/:id",
  authorize("ADMINISTRADOR", "GESTOR_PUBLICO"),
  validate(estacaoIdParamSchema, "params"),
  validate(updateEstacaoSchema, "body"),
  estacaoController.update
);

router.patch(
  "/:id/inativar",
  authorize("ADMINISTRADOR", "GESTOR_PUBLICO"),
  validate(estacaoIdParamSchema, "params"),
  estacaoController.inativar
);

export default router;