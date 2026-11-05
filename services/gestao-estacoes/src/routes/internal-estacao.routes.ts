import { Router } from "express";
import * as estacaoController from "../controllers/estacao.controller";
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

export default router;
