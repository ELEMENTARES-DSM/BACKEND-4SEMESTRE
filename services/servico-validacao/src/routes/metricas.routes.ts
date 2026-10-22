import { Router } from "express";
import { authMiddleware, checkRole } from "../middlewares/middleware";
import { obterMetricas } from "../controllers/metricas.controller";

const router = Router();

router.get("/", authMiddleware, checkRole(["ADMINISTRADOR"]), obterMetricas);

export default router;
