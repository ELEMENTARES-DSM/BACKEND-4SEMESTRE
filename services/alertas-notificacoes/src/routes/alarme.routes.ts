import { Router } from "express";
import * as alarmeController from "../controllers/alarme.controller";
import { validate } from "../middlewares/validate";
import { authMiddleware, checkRole } from "../middlewares/middleware";
import { alarmeIdParamSchema } from "../validations/alarme.validation";

const router = Router();

// US-24: o pesquisador não consulta alarmes.
const PAPEIS_PERMITIDOS = ["GESTOR_PUBLICO", "ADMINISTRADOR"];

router.use(authMiddleware, checkRole(PAPEIS_PERMITIDOS));

router.get("/", alarmeController.list);

// Antes de /:id, para "resumo" não ser lido como id.
router.get("/resumo", alarmeController.resumo);

router.get(
  "/:id",
  validate(alarmeIdParamSchema, "params"),
  alarmeController.findById
);

export default router;
