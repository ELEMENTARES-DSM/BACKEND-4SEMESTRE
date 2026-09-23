import { Router } from "express";
import * as estacaoController from "../controllers/estacao.controller";
import { authMiddleware } from "../middlewares/middleware";

const router = Router();

router.get("/estacoes/status", authMiddleware, estacaoController.status);

export default router;
